import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, seedTestData } from "@/test/helpers/db";
import { createRequest } from "@/test/helpers/request";
import { NextResponse } from "next/server";

const mockRequireAdmin = vi.fn();

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
  requireAuth: vi.fn(),
  requireAdmin: () => mockRequireAdmin(),
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
  mockRequireAdmin.mockReset();
});

const adminSession = { userId: 3, plexId: "plex-admin", username: "adminuser", isAdmin: true };

type CommunityItem = {
  id: number;
  title: string;
  mediaType: string;
  posterPath: string | null;
  status: string;
  tmdbId: number | null;
  imdbId: string | null;
  requestedByUsername: string;
  requestedAt: string;
  seasonCount: number | null;
  nominationType: "delete" | "trim";
  keepSeasons: number | null;
  watchStatus: {
    watched: boolean;
    playCount: number;
    lastWatchedAt: string | null;
  } | null;
  tally: {
    keepCount: number;
  };
  voters: {
    username: string;
    vote: string;
    votedAt: string;
  }[];
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  pages: number;
};

type CommunityResponse = {
  items: CommunityItem[];
  pagination: Pagination;
};

describe("GET /api/admin/community", () => {
  it("returns community candidates with tallies", async () => {
    mockRequireAdmin.mockResolvedValue(adminSession);
    const req = createRequest("http://localhost:3000/api/admin/community");
    const res = await GET(req);
    const data = (await res.json()) as CommunityResponse;

    expect(res.status).toBe(200);
    expect(data.items.length).toBe(3);
  });

  it("includes voter breakdown per item", async () => {
    mockRequireAdmin.mockResolvedValue(adminSession);
    const req = createRequest("http://localhost:3000/api/admin/community");
    const res = await GET(req);
    const data = (await res.json()) as CommunityResponse;

    const item2 = data.items.find((i) => i.title === "Test Movie 2");
    expect(item2).toBeDefined();
    expect(item2!.voters).toBeDefined();
    expect(item2!.voters.length).toBe(2);

    const voterNames = item2!.voters.map((v) => v.username);
    expect(voterNames).toContain("otheruser");
    expect(voterNames).toContain("adminuser");
  });

  it("includes vote value in voter breakdown", async () => {
    mockRequireAdmin.mockResolvedValue(adminSession);
    const req = createRequest("http://localhost:3000/api/admin/community");
    const res = await GET(req);
    const data = (await res.json()) as CommunityResponse;

    const item2 = data.items.find((i) => i.title === "Test Movie 2");
    expect(item2).toBeDefined();
    const otherVoter = item2!.voters.find((v) => v.username === "otheruser");
    expect(otherVoter!.vote).toBe("keep");

    const adminVoter = item2!.voters.find((v) => v.username === "adminuser");
    expect(adminVoter!.vote).toBe("keep");
  });

  it("returns correct tallies", async () => {
    mockRequireAdmin.mockResolvedValue(adminSession);
    const req = createRequest("http://localhost:3000/api/admin/community");
    const res = await GET(req);
    const data = (await res.json()) as CommunityResponse;

    const item2 = data.items.find((i) => i.title === "Test Movie 2");
    expect(item2).toBeDefined();
    expect(item2!.tally.keepCount).toBe(2);
  });

  it("does not duplicate items when both self and admin nominate", async () => {
    // Item 2 already has plex-user-1 vote=delete (self-nomination)
    // Admin also votes delete
    const sqlite = testDb.sqlite;
    sqlite.exec(
      `INSERT INTO user_votes (media_item_id, user_plex_id, vote) VALUES (2, 'plex-admin', 'delete')`
    );

    mockRequireAdmin.mockResolvedValue(adminSession);
    const req = createRequest("http://localhost:3000/api/admin/community");
    const res = await GET(req);
    const data = (await res.json()) as CommunityResponse;

    const item2Entries = data.items.filter((i) => i.title === "Test Movie 2");
    expect(item2Entries.length).toBe(1);
  });

  it("shows admin-nominated items in admin community list", async () => {
    // Admin nominates item 6 (belongs to plex-user-1) for deletion
    const sqlite = testDb.sqlite;
    sqlite.exec(
      `INSERT INTO user_votes (media_item_id, user_plex_id, vote) VALUES (6, 'plex-admin', 'delete')`
    );

    mockRequireAdmin.mockResolvedValue(adminSession);
    const req = createRequest("http://localhost:3000/api/admin/community");
    const res = await GET(req);
    const data = (await res.json()) as CommunityResponse;

    const titles = data.items.map((i) => i.title);
    expect(titles).toContain("Another Movie");
  });

  it("returns 403 for non-admin", async () => {
    mockRequireAdmin.mockRejectedValue(new AuthError("Admin access required", 403));
    const req = createRequest("http://localhost:3000/api/admin/community");
    const res = await GET(req);

    expect(res.status).toBe(403);
  });

  it("sorts by title_asc when sort param is provided", async () => {
    mockRequireAdmin.mockResolvedValue(adminSession);
    const req = createRequest("http://localhost:3000/api/admin/community?sort=title_asc");
    const res = await GET(req);
    const data = (await res.json()) as CommunityResponse;

    const titles = data.items.map((i) => i.title);
    const sorted = [...titles].sort((a, b) => a.localeCompare(b));
    expect(titles).toEqual(sorted);
  });

  it("sorts by requested_newest", async () => {
    mockRequireAdmin.mockResolvedValue(adminSession);
    const req = createRequest("http://localhost:3000/api/admin/community?sort=requested_newest");
    const res = await GET(req);
    const data = (await res.json()) as CommunityResponse;

    const dates = data.items.map((i) => i.requestedAt);
    for (let i = 0; i < dates.length - 1; i++) {
      expect(dates[i] >= dates[i + 1]).toBe(true);
    }
  });

  it("includes removed items in admin listing with status badge", async () => {
    const sqlite = testDb.sqlite;
    sqlite.exec(`UPDATE media_items SET status = 'removed' WHERE id = 2`);

    mockRequireAdmin.mockResolvedValue(adminSession);
    const req = createRequest("http://localhost:3000/api/admin/community");
    const res = await GET(req);
    const data = (await res.json()) as CommunityResponse;

    const removedItem = data.items.find((i) => i.title === "Test Movie 2");
    expect(removedItem).toBeDefined();
    expect(removedItem!.status).toBe("removed");
    expect(data.items.length).toBe(3);
    expect(data.pagination.total).toBe(3);
  });

  it("handles pagination", async () => {
    mockRequireAdmin.mockResolvedValue(adminSession);
    const req = createRequest("http://localhost:3000/api/admin/community?page=1&limit=1");
    const res = await GET(req);
    const data = (await res.json()) as CommunityResponse;

    expect(data.items.length).toBe(1);
    expect(data.pagination.total).toBe(3);
    expect(data.pagination.pages).toBe(3);
  });
});
