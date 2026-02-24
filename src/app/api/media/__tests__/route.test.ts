import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, seedTestData } from "../../../../test/helpers/db";
import { createRequest } from "../../../../test/helpers/request";
import { NextResponse } from "next/server";

interface TestMediaItem {
  id: number;
  title: string;
  mediaType: string;
  status: string;
  vote: string | null;
  watchStatus: { watched: boolean; playCount: number; lastWatchedAt: string } | null;
  nominations: { count: number; usernames: string[] } | null;
  requestedAt: string;
}

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
  console.error("Unexpected error:", error);
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

describe("GET /api/media", () => {
  it("defaults to source=my_requests, returning only user's own items", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest("http://localhost:3000/api/media");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    // 6 total items since we expect default source=my_requests
    expect(data.items.length).toBe(6);
  });

  it("source=my_requests returns only user's own items", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest("http://localhost:3000/api/media?source=my_requests");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.items.length).toBe(6);
    expect(data.items.every((i: TestMediaItem) => i.id !== 5)).toBe(true);
  });

  it("scope=personal does not return other users' items", async () => {
    mockRequireAuth.mockResolvedValue(otherSession);
    const req = createRequest("http://localhost:3000/api/media?source=my_requests");
    const res = await GET(req);
    const data = await res.json();

    expect(data.items.length).toBe(1);
    expect(data.items[0].id).toBe(5);
  });

  it("filters by type=movie", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest("http://localhost:3000/api/media?source=my_requests&type=movie");
    const res = await GET(req);
    const data = await res.json();

    expect(data.items.every((i: TestMediaItem) => i.mediaType === "movie")).toBe(true);
    expect(data.items.length).toBe(3);
  });

  it("filters by type=tv", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest("http://localhost:3000/api/media?source=my_requests&type=tv");
    const res = await GET(req);
    const data = await res.json();

    expect(data.items.every((i: TestMediaItem) => i.mediaType === "tv")).toBe(true);
    expect(data.items.length).toBe(3);
  });

  it("filters by status=available", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest(
      "http://localhost:3000/api/media?source=my_requests&status=available"
    );
    const res = await GET(req);
    const data = await res.json();

    expect(data.items.every((i: TestMediaItem) => i.status === "available")).toBe(true);
  });

  it("filters by status=pending", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest("http://localhost:3000/api/media?source=my_requests&status=pending");
    const res = await GET(req);
    const data = await res.json();

    expect(data.items.length).toBe(1);
    expect(data.items[0].title).toBe("Test Show 2");
  });

  it("filters by vote=nominated (delete or trim)", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest("http://localhost:3000/api/media?source=my_requests&vote=nominated");
    const res = await GET(req);
    const data = await res.json();

    expect(data.items.every((i: TestMediaItem) => i.vote === "delete" || i.vote === "trim")).toBe(
      true
    );
    expect(data.items.length).toBe(2);
  });

  it("filters by vote=none (no vote cast)", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest("http://localhost:3000/api/media?source=my_requests&vote=none");
    const res = await GET(req);
    const data = await res.json();

    expect(data.items.every((i: TestMediaItem) => i.vote === null)).toBe(true);
    expect(data.items.length).toBe(4);
  });

  it("filters by watched=true", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest("http://localhost:3000/api/media?source=my_requests&watched=true");
    const res = await GET(req);
    const data = await res.json();

    expect(data.items.length).toBe(1);
    expect(data.items[0].id).toBe(1);
  });

  it("combines type + vote filters", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest(
      "http://localhost:3000/api/media?source=my_requests&type=movie&vote=nominated"
    );
    const res = await GET(req);
    const data = await res.json();

    expect(data.items.length).toBe(1);
    expect(data.items[0].mediaType).toBe("movie");
    expect(data.items[0].vote).toBe("delete");
  });

  it("returns pagination metadata", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest("http://localhost:3000/api/media?source=my_requests&limit=2&page=1");
    const res = await GET(req);
    const data = await res.json();

    expect(data.pagination.page).toBe(1);
    expect(data.pagination.limit).toBe(2);
    expect(data.pagination.total).toBe(6);
    expect(data.pagination.pages).toBe(3);
  });

  it("paginates correctly - page 2", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest("http://localhost:3000/api/media?source=my_requests&limit=2&page=2");
    const res = await GET(req);
    const data = await res.json();

    expect(data.items.length).toBe(2);
    expect(data.pagination.page).toBe(2);
  });

  it("includes vote and watchStatus in response", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest("http://localhost:3000/api/media?source=my_requests");
    const res = await GET(req);
    const data = await res.json();

    const item1 = data.items.find((i: TestMediaItem) => i.id === 1);
    expect(item1.vote).toBeNull();
    expect(item1.watchStatus).toEqual({
      watched: true,
      playCount: 3,
      lastWatchedAt: "2024-06-01T00:00:00Z",
    });

    const item4 = data.items.find((i: TestMediaItem) => i.id === 4);
    expect(item4.vote).toBeNull();
    expect(item4.watchStatus).toBeNull();
  });

  it("pagination total reflects vote filter", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest("http://localhost:3000/api/media?source=my_requests&vote=nominated");
    const res = await GET(req);
    const data = await res.json();

    // 2 items have nominations (delete/trim), so total should be 2
    expect(data.pagination.total).toBe(2);
    expect(data.pagination.pages).toBe(1);
    expect(data.items.length).toBe(2);
  });

  it("pagination total reflects watched filter", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest("http://localhost:3000/api/media?source=my_requests&watched=true");
    const res = await GET(req);
    const data = await res.json();

    // Only 1 item has watched=true, total should be 1
    expect(data.pagination.total).toBe(1);
    expect(data.pagination.pages).toBe(1);
  });

  it("pagination total reflects combined filters", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest(
      "http://localhost:3000/api/media?source=my_requests&type=movie&vote=none"
    );
    const res = await GET(req);
    const data = await res.json();

    // Movies with no vote for plex-user-1: item 1 (Test Movie 1) and item 6 (Another Movie)
    expect(data.pagination.total).toBe(2);
    expect(data.pagination.pages).toBe(1);
  });

  it("filters by search term", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest("http://localhost:3000/api/media?source=my_requests&search=Big");
    const res = await GET(req);
    const data = await res.json();

    expect(data.items.length).toBe(1);
    expect(data.items[0].title).toBe("Big Brother");
  });

  it("returns empty when search has no matches", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest(
      "http://localhost:3000/api/media?source=my_requests&search=nonexistent"
    );
    const res = await GET(req);
    const data = await res.json();

    expect(data.items.length).toBe(0);
    expect(data.pagination.total).toBe(0);
  });

  it("excludes removed items by default", async () => {
    testDb.sqlite.exec(`UPDATE media_items SET status = 'removed' WHERE id = 1`);

    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest("http://localhost:3000/api/media?source=my_requests");
    const res = await GET(req);
    const data = await res.json();

    expect(data.items.find((i: TestMediaItem) => i.id === 1)).toBeUndefined();
    expect(data.items.length).toBe(5);
  });

  it("includes removed items when status=removed is explicit", async () => {
    testDb.sqlite.exec(`UPDATE media_items SET status = 'removed' WHERE id = 1`);

    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest("http://localhost:3000/api/media?source=my_requests&status=removed");
    const res = await GET(req);
    const data = await res.json();

    expect(data.items.length).toBe(1);
    expect(data.items[0].id).toBe(1);
    expect(data.items[0].status).toBe("removed");
  });

  it("sorts by title_desc (Z-A)", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest("http://localhost:3000/api/media?source=my_requests&sort=title_desc");
    const res = await GET(req);
    const data = await res.json();

    const titles = data.items.map((i: TestMediaItem) => i.title);
    const sorted = [...titles].sort((a: string, b: string) => b.localeCompare(a));
    expect(titles).toEqual(sorted);
  });

  it("sorts by requested_newest", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest(
      "http://localhost:3000/api/media?source=my_requests&sort=requested_newest"
    );
    const res = await GET(req);
    const data = await res.json();

    const dates = data.items.map((i: TestMediaItem) => i.requestedAt);
    for (let i = 0; i < dates.length - 1; i++) {
      expect(dates[i] >= dates[i + 1]).toBe(true);
    }
  });

  it("sorts by requested_oldest", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest(
      "http://localhost:3000/api/media?source=my_requests&sort=requested_oldest"
    );
    const res = await GET(req);
    const data = await res.json();

    const dates = data.items.map((i: TestMediaItem) => i.requestedAt);
    for (let i = 0; i < dates.length - 1; i++) {
      expect(dates[i] <= dates[i + 1]).toBe(true);
    }
  });

  it("source=all_requests shows current user's votes and watch status on other users' items", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest("http://localhost:3000/api/media?source=all_requests");
    const res = await GET(req);
    const data = await res.json();

    // Item 5 belongs to plex-user-2, current user (plex-user-1) has no vote on it
    const item5 = data.items.find((i: TestMediaItem) => i.id === 5);
    expect(item5).toBeDefined();
    expect(item5.vote).toBeNull();

    // Item 2 belongs to plex-user-1, who voted delete on it
    const item2 = data.items.find((i: TestMediaItem) => i.id === 2);
    expect(item2.vote).toBe("delete");
  });

  it("source=all_requests with vote=nominated only shows current user's nominations", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest("http://localhost:3000/api/media?source=all_requests&vote=nominated");
    const res = await GET(req);
    const data = await res.json();

    // plex-user-1 nominated items 2 and 7; plex-user-2's nomination on item 5
    // should NOT appear because votes are joined on current user's plexId
    expect(data.items.length).toBe(2);
    expect(data.items.every((i: TestMediaItem) => i.vote === "delete" || i.vote === "trim")).toBe(
      true
    );
  });

  it("includes nominations with nominator usernames for items with votes", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest("http://localhost:3000/api/media?source=my_requests");
    const res = await GET(req);
    const data = await res.json();

    // Item 2 has a delete vote from plex-user-1 (testuser)
    const item2 = data.items.find((i: TestMediaItem) => i.id === 2);
    expect(item2.nominations).toEqual({
      count: 1,
      usernames: ["testuser"],
      voters: [{ username: "testuser", vote: "delete", keepSeasons: null, comment: null }],
    });

    // Item 7 has a trim vote from plex-user-1 (testuser), keepSeasons=1
    const item7 = data.items.find((i: TestMediaItem) => i.id === 7);
    expect(item7.nominations).toEqual({
      count: 1,
      usernames: ["testuser"],
      voters: [{ username: "testuser", vote: "trim", keepSeasons: 1, comment: null }],
    });
  });

  it("returns null nominations for items without any votes", async () => {
    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest("http://localhost:3000/api/media?source=my_requests");
    const res = await GET(req);
    const data = await res.json();

    // Item 1 has no votes
    const item1 = data.items.find((i: TestMediaItem) => i.id === 1);
    expect(item1.nominations).toBeNull();
  });

  it("shows multiple nominators when multiple users vote on the same item", async () => {
    // Add an admin vote on item 2 (already has testuser's vote)
    testDb.sqlite.exec(
      `INSERT INTO user_votes (media_item_id, user_plex_id, vote) VALUES (2, 'plex-admin', 'delete')`
    );

    mockRequireAuth.mockResolvedValue(userSession);
    const req = createRequest("http://localhost:3000/api/media?source=my_requests");
    const res = await GET(req);
    const data = await res.json();

    const item2 = data.items.find((i: TestMediaItem) => i.id === 2);
    expect(item2.nominations.count).toBe(2);
    expect(item2.nominations.usernames).toContain("testuser");
    expect(item2.nominations.usernames).toContain("adminuser");
    expect(item2.nominations.voters).toHaveLength(2);
    expect(item2.nominations.voters).toContainEqual({
      username: "testuser",
      vote: "delete",
      keepSeasons: null,
      comment: null,
    });
    expect(item2.nominations.voters).toContainEqual({
      username: "adminuser",
      vote: "delete",
      keepSeasons: null,
      comment: null,
    });
  });

  it("returns 401 when not authenticated", async () => {
    mockRequireAuth.mockRejectedValue(new AuthError("Not authenticated", 401));
    const req = createRequest("http://localhost:3000/api/media");
    const res = await GET(req);

    expect(res.status).toBe(401);
  });
});
