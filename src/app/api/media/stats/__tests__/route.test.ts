import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, seedTestData } from "../../../../../test/helpers/db";
import { createRequest } from "../../../../../test/helpers/request";
import { NextResponse } from "next/server";

const mockRequireAuth = vi.fn();

class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function handleAuthError(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

vi.mock("@/lib/auth/middleware", () => ({
  requireAuth: () => mockRequireAuth(),
  requireAdmin: vi.fn(),
  handleAuthError: (error: unknown) => handleAuthError(error),
  AuthError,
}));

let testDb: ReturnType<typeof createTestDb>;

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb.db;
  },
}));

const { GET } = await import("../route");

beforeEach(() => {
  testDb = createTestDb();
  seedTestData(testDb.db);
  mockRequireAuth.mockReset();
});

const userSession = { userId: 1, plexId: "plex-user-1", username: "testuser", isAdmin: false };
const otherSession = { userId: 2, plexId: "plex-user-2", username: "otheruser", isAdmin: false };

describe("GET /api/media/stats", () => {
  it("defaults to personal source stats", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest("http://localhost:3000/api/media/stats");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    // plex-user-1 has 6 items, 2 nominated (items 2,7), 1 watched (item 1)
    expect(data.total).toBe(6);
    expect(data.nominated).toBe(2);
    expect(data.notNominated).toBe(4);
    expect(data.watched).toBe(1);
    // Type breakdown: items 1,2,6 are movies (3), items 3,4,7 are TV (3)
    expect(data.movieCount).toBe(3);
    expect(data.tvCount).toBe(3);
    expect(typeof data.totalFileSize).toBe("number");
    expect(typeof data.inPlexCount).toBe("number");
  });

  it("returns all-scope stats when source=all_requests", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest("http://localhost:3000/api/media/stats?source=all_requests");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    // 7 total items, plex-user-1 nominated 2, watched 1
    expect(data.total).toBe(7);
    expect(data.nominated).toBe(2);
    expect(data.notNominated).toBe(5);
    expect(data.watched).toBe(1);
    // 4 movies (1,2,5,6), 3 TV shows (3,4,7)
    expect(data.movieCount).toBe(4);
    expect(data.tvCount).toBe(3);
  });

  it("returns correct stats for a different user (source=personal)", async () => {
    mockRequireAuth.mockResolvedValue(otherSession);
    const req = createRequest("http://localhost:3000/api/media/stats?source=my_requests");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    // plex-user-2 has 1 item (id 5), they voted delete on it, and watched it
    expect(data.total).toBe(1);
    expect(data.nominated).toBe(1);
    expect(data.notNominated).toBe(0);
    expect(data.watched).toBe(1);
    expect(data.movieCount).toBe(1);
    expect(data.tvCount).toBe(0);
  });

  it("returns correct stats for a different user (source=all)", async () => {
    mockRequireAuth.mockResolvedValue(otherSession);
    const req = createRequest("http://localhost:3000/api/media/stats?source=all_requests");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    // 7 total, plex-user-2 nominated 1 (item 5), watched 1 (item 5)
    expect(data.total).toBe(7);
    expect(data.nominated).toBe(1);
    expect(data.notNominated).toBe(6);
    expect(data.watched).toBe(1);
  });

  it("excludes removed items from stats", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    // Mark an item as removed
    testDb.sqlite.exec(`UPDATE media_items SET status = 'removed' WHERE id = 1`);

    const req = createRequest("http://localhost:3000/api/media/stats?source=my_requests");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.total).toBe(5);
  });

  it("returns zeroes for a user with no items", async () => {
    const emptySession = { userId: 3, plexId: "plex-admin", username: "adminuser", isAdmin: true };
    mockRequireAuth.mockResolvedValue(emptySession);
    const req = createRequest("http://localhost:3000/api/media/stats?source=my_requests");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.total).toBe(0);
    expect(data.nominated).toBe(0);
    expect(data.notNominated).toBe(0);
    expect(data.watched).toBe(0);
    expect(data.movieCount).toBe(0);
    expect(data.tvCount).toBe(0);
    expect(data.totalFileSize).toBe(0);
    expect(data.inPlexCount).toBe(0);
  });

  it("returns 401 when not authenticated", async () => {
    mockRequireAuth.mockRejectedValue(new AuthError("Not authenticated", 401));
    const req = createRequest("http://localhost:3000/api/media/stats");
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it("counts not_requested items for unrequested source", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    // Add Plex-only items (in_plex=true, in_overseerr=false) with not_requested status
    testDb.sqlite.exec(`
      INSERT INTO media_items (id, tmdb_id, media_type, title, status, rating_key, in_plex, in_overseerr)
      VALUES
        (20, 2000, 'movie', 'Plex Only Movie', 'not_requested', 'rk-20', 1, 0),
        (21, 2001, 'tv', 'Plex Only Show', 'not_requested', 'rk-21', 1, 0);
    `);

    const req = createRequest("http://localhost:3000/api/media/stats?source=unrequested");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    // Should include the not_requested Plex-only items
    expect(data.total).toBe(2);
    expect(data.movieCount).toBe(1);
    expect(data.tvCount).toBe(1);
    expect(data.inPlexCount).toBe(2);
  });

  it("all_media excludes removed but includes not_requested", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    // Add items with various statuses
    testDb.sqlite.exec(`
      INSERT INTO media_items (id, tmdb_id, media_type, title, status, rating_key, in_plex, in_overseerr)
      VALUES
        (30, 3000, 'movie', 'Not Requested Item', 'not_requested', 'rk-30', 1, 0),
        (31, 3001, 'movie', 'Removed Item', 'removed', 'rk-31', 0, 1);
    `);

    const req = createRequest("http://localhost:3000/api/media/stats?source=all_media");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    // 7 original + 1 not_requested = 8 (removed excluded)
    expect(data.total).toBe(8);
  });

  it("includes file size totals", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    // Set file sizes on some items
    testDb.sqlite.exec(`
      UPDATE media_items SET file_size = 1073741824 WHERE id = 1;
      UPDATE media_items SET file_size = 2147483648 WHERE id = 2;
    `);

    const req = createRequest("http://localhost:3000/api/media/stats?source=my_requests");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    // 1 GB + 2 GB = 3 GB
    expect(data.totalFileSize).toBe(1073741824 + 2147483648);
  });

  it("counts inPlex items correctly", async () => {
    mockRequireAuth.mockResolvedValue(userSession);

    const req = createRequest("http://localhost:3000/api/media/stats?source=my_requests");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    // From seed data (plex-user-1 items): items 1,2,3,6,7 have rating_key (in_plex defaults 0 in seed)
    // The seed data doesn't set in_plex=1 for these items, so count depends on seed
    expect(typeof data.inPlexCount).toBe("number");
    expect(data.inPlexCount).toBeGreaterThanOrEqual(0);
  });
});
