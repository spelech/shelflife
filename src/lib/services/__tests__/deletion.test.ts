import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb } from "@/test/helpers/db";

// Declare testDb at module scope so the db mock getter can access it
let testDb: ReturnType<typeof createTestDb>;

vi.mock("@/lib/services/radarr", () => ({
  isRadarrConfigured: vi.fn(() => true),
  getRadarrClient: vi.fn(() => ({
    lookupByTmdbId: vi.fn(),
    deleteMovie: vi.fn(),
  })),
}));

vi.mock("@/lib/services/sonarr", () => ({
  isSonarrConfigured: vi.fn(() => true),
  getSonarrClient: vi.fn(() => ({
    lookupByTvdbId: vi.fn(),
    deleteSeries: vi.fn(),
  })),
}));

vi.mock("@/lib/services/request-service", () => ({
  getRequestServiceClient: vi.fn(() => ({
    deleteMedia: vi.fn(),
  })),
}));

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb.db;
  },
}));

type MockRadarrMovie = { id: number; title: string; [key: string]: unknown };
type MockSonarrSeries = { id: number; title: string; [key: string]: unknown };

beforeEach(() => {
  testDb = createTestDb();
  vi.restoreAllMocks();

  // Seed test data: a user and media items
  testDb.sqlite.exec(`
    INSERT INTO users (plex_id, username, is_admin) VALUES ('admin-1', 'admin', 1);
    INSERT INTO media_items (id, overseerr_id, tmdb_id, tvdb_id, media_type, title, status, requested_by_plex_id)
    VALUES
      (1, 100, 5000, NULL, 'movie', 'Test Movie', 'available', 'admin-1'),
      (2, 101, NULL, 3000, 'tv', 'Test Show', 'available', 'admin-1'),
      (3, 102, 6000, NULL, 'movie', 'No External', 'available', 'admin-1');
  `);
});

describe("executeMediaDeletion", () => {
  it("deletes movie via Radarr and Overseerr", async () => {
    const { isRadarrConfigured, getRadarrClient } = await import("@/lib/services/radarr");
    const { isSonarrConfigured } = await import("@/lib/services/sonarr");
    const { getRequestServiceClient } = await import("@/lib/services/request-service");
    const { executeMediaDeletion } = await import("../deletion");

    vi.mocked(isRadarrConfigured).mockReturnValue(true);
    vi.mocked(isSonarrConfigured).mockReturnValue(false);

    const mockRadarrClient = vi.mocked(getRadarrClient)();
    vi.mocked(mockRadarrClient.lookupByTmdbId).mockResolvedValue({
      id: 42,
      title: "Mock",
    } as MockRadarrMovie);
    vi.mocked(mockRadarrClient.deleteMovie).mockResolvedValue(undefined);
    vi.mocked(getRadarrClient).mockReturnValue(mockRadarrClient);

    const mockOverseerrClient = vi.mocked(getRequestServiceClient)();
    vi.mocked(mockOverseerrClient.deleteMedia).mockResolvedValue(undefined);
    vi.mocked(getRequestServiceClient).mockReturnValue(mockOverseerrClient);

    const result = await executeMediaDeletion({
      mediaItemId: 1,
      deleteFiles: true,
      deletedByPlexId: "admin-1",
    });

    expect(result.radarr.attempted).toBe(true);
    expect(result.radarr.success).toBe(true);
    expect(result.overseerr.attempted).toBe(true);
    expect(result.overseerr.success).toBe(true);
    expect(result.sonarr.attempted).toBe(false);

    // Verify media_items status updated to removed
    const row = testDb.sqlite.prepare("SELECT status FROM media_items WHERE id = 1").get() as {
      status: string;
    };
    expect(row.status).toBe("removed");

    // Verify deletion_log entry exists
    const logRow = testDb.sqlite
      .prepare("SELECT * FROM deletion_log WHERE media_item_id = 1")
      .get() as { radarr_success: number; overseerr_success: number };
    expect(logRow).toBeTruthy();
    expect(logRow.radarr_success).toBe(1);
    expect(logRow.overseerr_success).toBe(1);
  });

  it("deletes TV via Sonarr and Overseerr", async () => {
    const { isRadarrConfigured } = await import("@/lib/services/radarr");
    const { isSonarrConfigured, getSonarrClient } = await import("@/lib/services/sonarr");
    const { getRequestServiceClient } = await import("@/lib/services/request-service");
    const { executeMediaDeletion } = await import("../deletion");

    vi.mocked(isRadarrConfigured).mockReturnValue(false);
    vi.mocked(isSonarrConfigured).mockReturnValue(true);

    const mockSonarrClient = vi.mocked(getSonarrClient)();
    vi.mocked(mockSonarrClient.lookupByTvdbId).mockResolvedValue({ id: 55 } as MockSonarrSeries);
    vi.mocked(mockSonarrClient.deleteSeries).mockResolvedValue(undefined);
    vi.mocked(getSonarrClient).mockReturnValue(mockSonarrClient);

    const mockOverseerrClient = vi.mocked(getRequestServiceClient)();
    vi.mocked(mockOverseerrClient.deleteMedia).mockResolvedValue(undefined);
    vi.mocked(getRequestServiceClient).mockReturnValue(mockOverseerrClient);

    const result = await executeMediaDeletion({
      mediaItemId: 2,
      deleteFiles: true,
      deletedByPlexId: "admin-1",
    });

    expect(result.sonarr.attempted).toBe(true);
    expect(result.sonarr.success).toBe(true);
    expect(result.overseerr.attempted).toBe(true);
    expect(result.overseerr.success).toBe(true);
    expect(result.radarr.attempted).toBe(false);

    // Verify media_items status updated to removed
    const row = testDb.sqlite.prepare("SELECT status FROM media_items WHERE id = 2").get() as {
      status: string;
    };
    expect(row.status).toBe("removed");
  });

  it("handles partial failure (Radarr fails, Overseerr succeeds)", async () => {
    const { isRadarrConfigured, getRadarrClient } = await import("@/lib/services/radarr");
    const { isSonarrConfigured } = await import("@/lib/services/sonarr");
    const { getRequestServiceClient } = await import("@/lib/services/request-service");
    const { executeMediaDeletion } = await import("../deletion");

    vi.mocked(isRadarrConfigured).mockReturnValue(true);
    vi.mocked(isSonarrConfigured).mockReturnValue(false);

    const mockRadarrClient = vi.mocked(getRadarrClient)();
    vi.mocked(mockRadarrClient.lookupByTmdbId).mockRejectedValue(
      new Error("Radarr connection refused")
    );
    vi.mocked(getRadarrClient).mockReturnValue(mockRadarrClient);

    const mockOverseerrClient = vi.mocked(getRequestServiceClient)();
    vi.mocked(mockOverseerrClient.deleteMedia).mockResolvedValue(undefined);
    vi.mocked(getRequestServiceClient).mockReturnValue(mockOverseerrClient);

    const result = await executeMediaDeletion({
      mediaItemId: 1,
      deleteFiles: true,
      deletedByPlexId: "admin-1",
    });

    expect(result.radarr.attempted).toBe(true);
    expect(result.radarr.success).toBe(false);
    expect(result.radarr.error).toContain("Radarr connection refused");
    expect(result.overseerr.success).toBe(true);

    // Status should still be updated to removed
    const row = testDb.sqlite.prepare("SELECT status FROM media_items WHERE id = 1").get() as {
      status: string;
    };
    expect(row.status).toBe("removed");
  });

  it("handles item not found in external service as success", async () => {
    const { isRadarrConfigured, getRadarrClient } = await import("@/lib/services/radarr");
    const { isSonarrConfigured } = await import("@/lib/services/sonarr");
    const { getRequestServiceClient } = await import("@/lib/services/request-service");
    const { executeMediaDeletion } = await import("../deletion");

    vi.mocked(isRadarrConfigured).mockReturnValue(true);
    vi.mocked(isSonarrConfigured).mockReturnValue(false);

    const mockRadarrClient = vi.mocked(getRadarrClient)();
    // lookupByTmdbId returns null -- movie not in Radarr anymore
    vi.mocked(mockRadarrClient.lookupByTmdbId).mockResolvedValue(null);
    vi.mocked(getRadarrClient).mockReturnValue(mockRadarrClient);

    const mockOverseerrClient = vi.mocked(getRequestServiceClient)();
    vi.mocked(mockOverseerrClient.deleteMedia).mockResolvedValue(undefined);
    vi.mocked(getRequestServiceClient).mockReturnValue(mockOverseerrClient);

    const result = await executeMediaDeletion({
      mediaItemId: 1,
      deleteFiles: true,
      deletedByPlexId: "admin-1",
    });

    // Not found in Radarr is treated as success
    expect(result.radarr.attempted).toBe(true);
    expect(result.radarr.success).toBe(true);
  });

  it("skips Sonarr when not configured", async () => {
    const { isRadarrConfigured } = await import("@/lib/services/radarr");
    const { isSonarrConfigured } = await import("@/lib/services/sonarr");
    const { getRequestServiceClient } = await import("@/lib/services/request-service");
    const { executeMediaDeletion } = await import("../deletion");

    vi.mocked(isRadarrConfigured).mockReturnValue(false);
    vi.mocked(isSonarrConfigured).mockReturnValue(false);

    const mockOverseerrClient = vi.mocked(getRequestServiceClient)();
    vi.mocked(mockOverseerrClient.deleteMedia).mockResolvedValue(undefined);
    vi.mocked(getRequestServiceClient).mockReturnValue(mockOverseerrClient);

    const result = await executeMediaDeletion({
      mediaItemId: 2,
      deleteFiles: false,
      deletedByPlexId: "admin-1",
    });

    expect(result.sonarr.attempted).toBe(false);
    expect(result.sonarr.success).toBeNull();
  });

  it("throws when media item already removed", async () => {
    const { executeMediaDeletion } = await import("../deletion");

    // Mark item as already removed
    testDb.sqlite.exec(`UPDATE media_items SET status = 'removed' WHERE id = 1`);

    await expect(
      executeMediaDeletion({
        mediaItemId: 1,
        deleteFiles: true,
        deletedByPlexId: "admin-1",
      })
    ).rejects.toThrow("Media item already removed: 1");
  });

  it("throws when media item not found", async () => {
    const { executeMediaDeletion } = await import("../deletion");

    await expect(
      executeMediaDeletion({
        mediaItemId: 999,
        deleteFiles: true,
        deletedByPlexId: "admin-1",
      })
    ).rejects.toThrow("Media item not found: 999");
  });

  it("writes deletion_log with errors", async () => {
    const { isRadarrConfigured, getRadarrClient } = await import("@/lib/services/radarr");
    const { isSonarrConfigured } = await import("@/lib/services/sonarr");
    const { getRequestServiceClient } = await import("@/lib/services/request-service");
    const { executeMediaDeletion } = await import("../deletion");

    vi.mocked(isRadarrConfigured).mockReturnValue(true);
    vi.mocked(isSonarrConfigured).mockReturnValue(false);

    const mockRadarrClient = vi.mocked(getRadarrClient)();
    vi.mocked(mockRadarrClient.lookupByTmdbId).mockRejectedValue(new Error("Radarr timeout"));
    vi.mocked(getRadarrClient).mockReturnValue(mockRadarrClient);

    const mockOverseerrClient = vi.mocked(getRequestServiceClient)();
    vi.mocked(mockOverseerrClient.deleteMedia).mockResolvedValue(undefined);
    vi.mocked(getRequestServiceClient).mockReturnValue(mockOverseerrClient);

    await executeMediaDeletion({
      mediaItemId: 1,
      deleteFiles: true,
      deletedByPlexId: "admin-1",
    });

    const logRow = testDb.sqlite
      .prepare("SELECT * FROM deletion_log WHERE media_item_id = 1")
      .get() as { radarr_success: number; errors: string };
    expect(logRow).toBeTruthy();
    expect(logRow.radarr_success).toBe(0);

    const errors = JSON.parse(logRow.errors);
    expect(errors).toContainEqual(expect.stringContaining("radarr: Radarr timeout"));
  });
});
