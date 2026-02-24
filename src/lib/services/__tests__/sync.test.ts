import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, seedTestData } from "../../../test/helpers/db";
import { eq } from "drizzle-orm";
import { syncLog, mediaItems, watchStatus } from "../../db/schema";

let testDb: ReturnType<typeof createTestDb>;

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb.db;
  },
}));

const mockGetAllRequests = vi.fn();
const mockGetMediaDetails = vi.fn();

vi.mock("../overseerr", () => ({
  mapMediaStatus: (status: number | null | undefined) => {
    const map: Record<number, string> = {
      1: "unknown",
      2: "pending",
      3: "processing",
      4: "partial",
      5: "available",
    };
    return map[status ?? 1] || "unknown";
  },
}));

vi.mock("../request-service", () => ({
  getRequestServiceClient: () => ({
    getAllRequests: mockGetAllRequests,
    getMediaDetails: mockGetMediaDetails,
  }),
  getProviderLabel: () => "Overseerr",
}));

const mockGetHistory = vi.fn();
const mockGetTautulliUsers = vi.fn();
const mockGetLibraries = vi.fn();
const mockGetLibraryMediaInfo = vi.fn();
const mockGetServerInfo = vi.fn();

vi.mock("../tautulli", () => ({
  getTautulliClient: () => ({
    getHistory: mockGetHistory,
    getUsers: mockGetTautulliUsers,
    getLibraries: mockGetLibraries,
    getLibraryMediaInfo: mockGetLibraryMediaInfo,
    getServerInfo: mockGetServerInfo,
  }),
}));

const mockGetAllSeries = vi.fn();
vi.mock("../sonarr", () => ({
  getSonarrClient: () => ({
    getAllSeries: mockGetAllSeries,
  }),
  isSonarrConfigured: () => true,
}));

const mockGetAllMovies = vi.fn();
vi.mock("../radarr", () => ({
  getRadarrClient: () => ({
    getAllMovies: mockGetAllMovies,
  }),
  isRadarrConfigured: () => true,
}));

vi.mock("../sync-logger", () => ({
  syncLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    clear: vi.fn(),
  },
}));

const mockIsPlexSyncEnabled = vi.fn();
const mockGetSelectedLibraries = vi.fn();
vi.mock("../settings", () => ({
  isPlexSyncEnabled: () => mockIsPlexSyncEnabled(),
  getSelectedLibraries: () => mockGetSelectedLibraries(),
}));

const { runFullSync, syncLayer1Plex, syncLayer3Overseerr } = await import("../sync");

beforeEach(() => {
  testDb = createTestDb();
  seedTestData(testDb.db);
  vi.clearAllMocks();

  mockGetLibraries.mockResolvedValue([]);
  mockGetSelectedLibraries.mockResolvedValue([]);
  mockGetLibraryMediaInfo.mockResolvedValue([]);
  mockGetServerInfo.mockResolvedValue({ pmsUrl: "http://localhost:32400" });
  mockGetAllSeries.mockResolvedValue([]);
  mockGetAllMovies.mockResolvedValue([]);
  mockGetAllRequests.mockResolvedValue([]);
  mockIsPlexSyncEnabled.mockResolvedValue(false);
});

describe("runFullSync (3-Layer Sync)", () => {
  it("executes all layers and updates syncLog", async () => {
    mockIsPlexSyncEnabled.mockResolvedValue(true);
    mockGetLibraries.mockResolvedValue([
      { section_id: "1", section_name: "Movies", section_type: "movie" },
    ]);
    mockGetLibraryMediaInfo.mockResolvedValue([
      { rating_key: "rk-1", title: "Plex Movie", media_type: "movie", file_size: "123" },
    ]);
    mockGetTautulliUsers.mockResolvedValue([]);
    mockGetHistory.mockResolvedValue([]);

    mockGetAllMovies.mockResolvedValue([{ title: "Plex Movie", tmdbId: 100 }]);
    mockGetAllRequests.mockResolvedValue([
      { id: 10, media: { id: 200, tmdbId: 100 }, type: "movie", createdAt: "2024" },
    ]);

    const result = await runFullSync();
    expect(result.itemsSynced).toBeGreaterThan(0);

    const items = testDb.db.select().from(mediaItems).where(eq(mediaItems.ratingKey, "rk-1")).all();
    expect(items.length).toBe(1);
    expect(items[0].inPlex).toBe(true);
    expect(items[0].inSonarrRadarr).toBe(true);
    expect(items[0].inOverseerr).toBe(true);

    const logs = testDb.db.select().from(syncLog).all();
    const lastLog = logs[logs.length - 1];
    expect(lastLog.status).toBe("completed");
    expect(lastLog.currentLayer).toBe(3);
  });

  it("adds a missing sonarr item that is not in Plex", async () => {
    mockIsPlexSyncEnabled.mockResolvedValue(true);
    mockGetAllSeries.mockResolvedValue([{ title: "Missing Show", tvdbId: 999 }]);

    const result = await runFullSync();
    expect(result.itemsSynced).toBeGreaterThan(0);

    const items = testDb.db.select().from(mediaItems).where(eq(mediaItems.tvdbId, 999)).all();
    expect(items.length).toBe(1);
    expect(items[0].inPlex).toBe(false);
    expect(items[0].inSonarrRadarr).toBe(true);
  });

  it("marks failed syncLog heavily on root error", async () => {
    mockIsPlexSyncEnabled.mockResolvedValue(true);
    mockGetLibraries.mockRejectedValue(new Error("Network disconnect"));

    await expect(runFullSync()).rejects.toThrow("Network disconnect");

    const logs = testDb.db.select().from(syncLog).all();
    const lastLog = logs[logs.length - 1];
    expect(lastLog.status).toBe("failed");
    expect(lastLog.errors).toContain("Network disconnect");
  });

  it("skips Layer 1 when plex_sync_enabled is false", async () => {
    mockIsPlexSyncEnabled.mockResolvedValue(false);
    mockGetAllRequests.mockResolvedValue([]);

    const result = await runFullSync();

    // Should still complete successfully
    const logs = testDb.db.select().from(syncLog).all();
    const lastLog = logs[logs.length - 1];
    expect(lastLog.status).toBe("completed");

    // Layer 1 (Plex) was skipped but final count includes seeded items
    expect(result.itemsSynced).toBe(7);

    // No items should have inPlex set to true from this sync
    const plexItems = testDb.db
      .select()
      .from(mediaItems)
      .where(eq(mediaItems.inPlex, true))
      .all()
      .filter((i) => i.lastSyncedAt !== null);
    expect(plexItems.length).toBe(0);
  });
});

describe("syncLayer3Overseerr (Overseerr behavior)", () => {
  it("returns 0 for empty requests", async () => {
    mockGetAllRequests.mockResolvedValue([]);
    const count = await syncLayer3Overseerr(1);
    expect(count).toBe(0);
  });

  it("does not mark all items as removed when Overseerr returns empty (safety guard)", async () => {
    mockGetAllRequests.mockResolvedValue([]);
    await syncLayer3Overseerr(1);

    // Items should NOT be marked as removed — safety guard should prevent mass removal
    const removed = testDb.db
      .select()
      .from(mediaItems)
      .where(eq(mediaItems.status, "removed"))
      .all();
    expect(removed.length).toBe(0);
  });

  it("syncs availableSeasonCount for TV shows", async () => {
    mockGetAllRequests.mockResolvedValue([
      {
        id: 210,
        status: 2,
        createdAt: "2024-06-01",
        updatedAt: "2024-06-02",
        type: "tv",
        media: { id: 310, tmdbId: 6000, status: 5, ratingKey: "rk-tv" },
        requestedBy: { id: 1, plexId: 111, plexUsername: "tvuser" },
      },
    ]);
    mockGetMediaDetails.mockResolvedValue({
      id: 6000,
      name: "Great Show",
      numberOfSeasons: 5,
      mediaInfo: {
        seasons: [
          { seasonNumber: 1, status: 5 },
          { seasonNumber: 2, status: 5 },
          { seasonNumber: 3, status: 4 },
          { seasonNumber: 4, status: 3 },
          { seasonNumber: 5, status: 2 },
        ],
      },
    });

    await syncLayer3Overseerr(1);

    const items = testDb.db.select().from(mediaItems).where(eq(mediaItems.overseerrId, 310)).all();
    expect(items[0].seasonCount).toBe(5);
    expect(items[0].availableSeasonCount).toBe(3);
  });
});

describe("syncLayer1Plex (Tautulli behavior)", () => {
  it("creates watch_status records for matched users", async () => {
    mockGetLibraries.mockResolvedValue([
      { section_id: "1", section_name: "Movies", section_type: "movie" },
    ]);
    mockGetLibraryMediaInfo.mockResolvedValue([
      { rating_key: "rk-1", title: "Show 1", media_type: "movie" },
    ]);
    mockGetTautulliUsers.mockResolvedValue([
      { user_id: 10, username: "testuser", friendly_name: "testuser" },
    ]);
    mockGetHistory.mockResolvedValue([
      { user_id: 10, rating_key: "rk-1", watched_status: 1, stopped: 1700000000 },
    ]);

    const count = await syncLayer1Plex(1);
    expect(count).toBeGreaterThanOrEqual(1);

    const rows = testDb.db.select().from(watchStatus).where(eq(watchStatus.mediaItemId, 1)).all();
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("does not inflate play count on repeated syncs", async () => {
    mockGetLibraries.mockResolvedValue([
      { section_id: "1", section_name: "Movies", section_type: "movie" },
    ]);
    mockGetLibraryMediaInfo.mockResolvedValue([
      { rating_key: "rk-1", title: "Show 1", media_type: "movie" },
    ]);
    mockGetTautulliUsers.mockResolvedValue([
      { user_id: 10, username: "testuser", friendly_name: "testuser" },
    ]);
    const historyRecords = [
      { user_id: 10, rating_key: "rk-1", watched_status: 1, stopped: 1700000000 },
      { user_id: 10, rating_key: "rk-1", watched_status: 1, stopped: 1700001000 },
    ];
    mockGetHistory.mockResolvedValue(historyRecords);

    // First sync
    await syncLayer1Plex(1);

    // Second sync with same data
    mockGetHistory.mockResolvedValue(historyRecords);
    await syncLayer1Plex(1);

    // Play count should be 2 (the number of history records), NOT 4
    const rows = testDb.db.select().from(watchStatus).where(eq(watchStatus.mediaItemId, 1)).all();
    const row = rows.find((r) => r.userPlexId === "plex-user-1");
    expect(row).toBeDefined();
    expect(row!.playCount).toBe(2);
  });

  it("handles Plex API failure gracefully", async () => {
    mockGetTautulliUsers.mockResolvedValue([]);
    mockGetHistory.mockResolvedValue([]);
    mockGetLibraries.mockResolvedValue([
      { section_id: "2", section_name: "TV Shows", section_type: "show" },
    ]);
    mockGetLibraryMediaInfo.mockResolvedValue([
      { rating_key: "rk-3", title: "Show 1", file_size: "" },
    ]);
    mockGetServerInfo.mockResolvedValue({ pmsUrl: "http://plex:32400" });

    testDb.sqlite.exec(`UPDATE users SET plex_token = 'test-token' WHERE plex_id = 'plex-admin'`);

    // Plex API returns error
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));

    // Should not throw — error is caught
    await syncLayer1Plex(1);

    // File size should remain null
    const show = testDb.db.select().from(mediaItems).where(eq(mediaItems.id, 3)).all();
    expect(show[0].fileSize).toBeNull();

    vi.unstubAllGlobals();
  });
});
