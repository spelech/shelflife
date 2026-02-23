import { db } from "@/lib/db";
import { mediaItems, watchStatus, syncLog, users } from "@/lib/db/schema";
import { mapMediaStatus } from "./overseerr";
import { getRequestServiceClient, getProviderLabel } from "./request-service";
import { getTautulliClient } from "./tautulli";
import { getSonarrClient, isSonarrConfigured } from "./sonarr";
import { getRadarrClient, isRadarrConfigured } from "./radarr";
import { upsertUser } from "./user-upsert";
import { eq, and, isNotNull } from "drizzle-orm";
import { syncLogger } from "./sync-logger";
import { isPlexSyncEnabled } from "./settings";

export interface SyncProgress {
  phase: "overseerr" | "tautulli";
  step: string;
  current: number;
  total: number;
  detail?: string;
}

type ProgressCallback = (progress: SyncProgress) => void;
type TautulliClientType = ReturnType<typeof getTautulliClient>;

async function fetchPlexTvFileSizes(
  client: TautulliClientType,
  sectionIds: string[]
): Promise<Map<string, number>> {
  const fileSizeMap = new Map<string, number>();

  const { pmsUrl } = await client.getServerInfo();
  const admin = await db.select().from(users).where(eq(users.isAdmin, true)).limit(1);
  const plexToken = admin[0]?.plexToken;
  if (!plexToken) return fileSizeMap;

  for (const sectionId of sectionIds) {
    const url = `${pmsUrl}/library/sections/${sectionId}/all?type=4`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "X-Plex-Token": plexToken },
    });
    if (!res.ok) continue;

    const json = await res.json();
    const episodes = json?.MediaContainer?.Metadata;
    if (!Array.isArray(episodes)) continue;

    for (const ep of episodes) {
      const showRatingKey = ep.grandparentRatingKey;
      if (!showRatingKey) continue;
      const key = String(showRatingKey);

      for (const media of ep.Media ?? []) {
        for (const part of media.Part ?? []) {
          if (part.size && Number(part.size) > 0) {
            fileSizeMap.set(key, (fileSizeMap.get(key) || 0) + Number(part.size));
          }
        }
      }
    }
  }

  return fileSizeMap;
}

export async function syncLayer1Plex(
  _logId: number,
  onProgress?: ProgressCallback
): Promise<number> {
  const client = getTautulliClient();
  let synced = 0;

  syncLogger.info("Layer 1 - Plex", "Starting Layer 1: Plex via Tautulli");
  const libraries = await client.getLibraries();

  const allRatingKeys = new Set<string>();
  const fileSizeMap = new Map<string, number>();

  // First, get file sizes using the existing strategy
  syncLogger.info("Layer 1 - Plex", "Fetching library sizes...");
  try {
    for (const lib of libraries) {
      const sectionId = String(lib.section_id);
      const mediaInfo = await client.getLibraryMediaInfo(sectionId);
      for (const item of mediaInfo) {
        if (item.rating_key && item.file_size) {
          const size = Number(item.file_size);
          if (size > 0) fileSizeMap.set(String(item.rating_key), size);
        }
      }
    }

    const sectionsToFetch = libraries
      .filter((l) => l.section_type === "show")
      .map((l) => String(l.section_id));

    if (sectionsToFetch.length > 0) {
      syncLogger.info("Layer 1 - Plex", "Fetching TV show sizes via Plex fallback...");
      const plexSizes = await fetchPlexTvFileSizes(client, sectionsToFetch);
      for (const [rk, size] of plexSizes) {
        if (!fileSizeMap.has(rk)) fileSizeMap.set(rk, size);
      }
    }
  } catch (err) {
    syncLogger.warn("Layer 1 - Plex", `Failed to fetch some file sizes. ${err}`);
  }

  // Iterate libraries to insert basic metadata
  for (const lib of libraries) {
    syncLogger.info(
      "Layer 1 - Plex",
      `Processing library: ${lib.section_name} (${lib.section_id})`
    );

    // Notify UI (if legacy ProgressCallback is needed)
    onProgress?.({
      phase: "tautulli",
      step: `Scanning Plex Library: ${lib.section_name}`,
      current: 0,
      total: 0,
    });

    const mediaInfo = await client.getLibraryMediaInfo(String(lib.section_id));

    for (const item of mediaInfo) {
      if (!item.rating_key) continue;
      const rk = String(item.rating_key);
      allRatingKeys.add(rk);
      const mediaType = item.media_type === "movie" ? "movie" : "tv";
      const size = fileSizeMap.get(rk) || null;

      const existing = await db
        .select()
        .from(mediaItems)
        .where(eq(mediaItems.ratingKey, rk))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(mediaItems)
          .set({
            title: item.title || "Unknown",
            mediaType,
            inPlex: true,
            fileSize: size,
            lastSyncedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(mediaItems.id, existing[0].id));
      } else {
        await db.insert(mediaItems).values({
          ratingKey: rk,
          title: item.title || "Unknown",
          mediaType,
          inPlex: true,
          fileSize: size,
          lastSyncedAt: new Date().toISOString(),
        });
      }
      synced++;
    }
  }

  // Sync Watch History - limit to items actually in the DB
  syncLogger.info("Layer 1 - Plex", "Syncing watch history...");
  const tautulliUsers = await client.getUsers();
  const localItems = await db.select().from(mediaItems).where(eq(mediaItems.inPlex, true));

  let processed = 0;
  for (const item of localItems) {
    if (!item.ratingKey) continue;
    processed++;
    if (processed % 100 === 0) {
      syncLogger.info(
        "Layer 1 - Plex",
        `Synced watch history for ${processed}/${localItems.length} items.`
      );
    }

    try {
      const history = await client.getHistory(item.ratingKey);
      const byUser = new Map<
        string,
        { watched: boolean; playCount: number; lastWatchedAt: string | null }
      >();

      for (const record of history) {
        if (!record.user_id) continue;
        const tautulliUser = tautulliUsers.find((u) => u.user_id === record.user_id);
        if (!tautulliUser) continue;

        const localUser = await db
          .select()
          .from(users)
          .where(eq(users.username, tautulliUser.friendly_name || tautulliUser.username))
          .limit(1);

        if (localUser.length === 0) continue;
        const userPlexId = localUser[0].plexId;

        const existing = byUser.get(userPlexId) || {
          watched: false,
          playCount: 0,
          lastWatchedAt: null,
        };
        existing.playCount += 1;
        if (record.watched_status === 1) existing.watched = true;
        if (record.stopped) {
          const date = new Date(record.stopped * 1000).toISOString();
          if (!existing.lastWatchedAt || date > existing.lastWatchedAt)
            existing.lastWatchedAt = date;
        }
        byUser.set(userPlexId, existing);
      }

      for (const [userPlexId, agg] of byUser) {
        const existingWatch = await db
          .select()
          .from(watchStatus)
          .where(and(eq(watchStatus.mediaItemId, item.id), eq(watchStatus.userPlexId, userPlexId)))
          .limit(1);

        if (existingWatch.length > 0) {
          await db
            .update(watchStatus)
            .set({
              watched: agg.watched || existingWatch[0].watched,
              playCount: agg.playCount,
              lastWatchedAt: agg.lastWatchedAt || existingWatch[0].lastWatchedAt,
              syncedAt: new Date().toISOString(),
            })
            .where(eq(watchStatus.id, existingWatch[0].id));
        } else {
          await db.insert(watchStatus).values({
            mediaItemId: item.id,
            userPlexId,
            watched: agg.watched,
            playCount: agg.playCount,
            lastWatchedAt: agg.lastWatchedAt,
          });
        }
      }
    } catch {
      syncLogger.warn("Layer 1 - Plex", `Failed history sync for ${item.title}`);
    }
  }

  // Any item in DB whose ratingKey is truthy but NOT in allRatingKeys is no longer in Plex
  syncLogger.info("Layer 1 - Plex", "Marking items no longer in Plex...");
  const allDbItems = await db.select().from(mediaItems).where(isNotNull(mediaItems.ratingKey));
  for (const item of allDbItems) {
    if (item.ratingKey && !allRatingKeys.has(item.ratingKey)) {
      await db.update(mediaItems).set({ inPlex: false }).where(eq(mediaItems.id, item.id));
    }
  }

  return synced;
}

async function syncLayer2Arr(_logId: number, _onProgress?: ProgressCallback): Promise<number> {
  let synced = 0;
  syncLogger.info("Layer 2 - Sonarr/Radarr", "Starting Layer 2: Sonarr and Radarr Sync");

  // Track the TMDB/TVDB ids we see
  const seenTvdb = new Set<number>();
  const seenTmdb = new Set<number>();

  if (isSonarrConfigured()) {
    syncLogger.info("Layer 2 - Sonarr", "Fetching all series from Sonarr...");
    try {
      const client = getSonarrClient();
      const seriesList = await client.getAllSeries();

      for (const series of seriesList) {
        const tvdbId = series.tvdbId as number | undefined;
        if (!tvdbId) continue;
        seenTvdb.add(tvdbId);

        // Try to match by tvdbId
        const existing = await db
          .select()
          .from(mediaItems)
          .where(eq(mediaItems.tvdbId, tvdbId))
          .limit(1);
        if (existing.length > 0) {
          await db
            .update(mediaItems)
            .set({
              inSonarrRadarr: true,
              title: existing[0].title === "Unknown" ? series.title : existing[0].title,
              lastSyncedAt: new Date().toISOString(),
            })
            .where(eq(mediaItems.id, existing[0].id));
        } else {
          // Alternatively, try to match by title/media_type if tvdbId missing but ratingKey exists
          const byTitle = await db
            .select()
            .from(mediaItems)
            .where(and(eq(mediaItems.title, series.title), eq(mediaItems.mediaType, "tv")))
            .limit(1);
          if (byTitle.length > 0) {
            await db
              .update(mediaItems)
              .set({ inSonarrRadarr: true, tvdbId, lastSyncedAt: new Date().toISOString() })
              .where(eq(mediaItems.id, byTitle[0].id));
          } else {
            // Upsert new item not in Plex (managed by Sonarr)
            await db.insert(mediaItems).values({
              tvdbId,
              title: series.title,
              mediaType: "tv",
              inSonarrRadarr: true,
              inPlex: false,
              inOverseerr: false,
              lastSyncedAt: new Date().toISOString(),
            });
          }
        }
        synced++;
      }
    } catch (e) {
      syncLogger.error("Layer 2 - Sonarr", `Error syncing Sonarr: ${e}`);
    }
  }

  if (isRadarrConfigured()) {
    syncLogger.info("Layer 2 - Radarr", "Fetching all movies from Radarr...");
    try {
      const client = getRadarrClient();
      const movieList = await client.getAllMovies();

      for (const movie of movieList) {
        const tmdbId = movie.tmdbId as number | undefined;
        if (!tmdbId) continue;
        seenTmdb.add(tmdbId);

        const existing = await db
          .select()
          .from(mediaItems)
          .where(eq(mediaItems.tmdbId, tmdbId))
          .limit(1);
        if (existing.length > 0) {
          await db
            .update(mediaItems)
            .set({
              inSonarrRadarr: true,
              title: existing[0].title === "Unknown" ? movie.title : existing[0].title,
              lastSyncedAt: new Date().toISOString(),
            })
            .where(eq(mediaItems.id, existing[0].id));
        } else {
          const byTitle = await db
            .select()
            .from(mediaItems)
            .where(and(eq(mediaItems.title, movie.title), eq(mediaItems.mediaType, "movie")))
            .limit(1);
          if (byTitle.length > 0) {
            await db
              .update(mediaItems)
              .set({ inSonarrRadarr: true, tmdbId, lastSyncedAt: new Date().toISOString() })
              .where(eq(mediaItems.id, byTitle[0].id));
          } else {
            // Upsert new item not in Plex (managed by Radarr)
            await db.insert(mediaItems).values({
              tmdbId,
              title: movie.title,
              mediaType: "movie",
              inSonarrRadarr: true,
              inPlex: false,
              inOverseerr: false,
              lastSyncedAt: new Date().toISOString(),
            });
          }
        }
        synced++;
      }
    } catch (e) {
      syncLogger.error("Layer 2 - Radarr", `Error syncing Radarr: ${e}`);
    }
  }

  // Items in DB marked inSonarrRadarr but no longer exist in Sonarr/Radarr
  const arrItems = await db.select().from(mediaItems).where(eq(mediaItems.inSonarrRadarr, true));
  for (const item of arrItems) {
    if (item.mediaType === "tv" && item.tvdbId && !seenTvdb.has(item.tvdbId)) {
      await db.update(mediaItems).set({ inSonarrRadarr: false }).where(eq(mediaItems.id, item.id));
    } else if (item.mediaType === "movie" && item.tmdbId && !seenTmdb.has(item.tmdbId)) {
      await db.update(mediaItems).set({ inSonarrRadarr: false }).where(eq(mediaItems.id, item.id));
    }
  }

  return synced;
}

export async function syncLayer3Overseerr(
  _logId: number,
  _onProgress?: ProgressCallback
): Promise<number> {
  const client = getRequestServiceClient();
  const providerLabel = getProviderLabel();
  let synced = 0;

  syncLogger.info("Layer 3 - Overseerr", `Fetching requests from ${providerLabel}...`);
  const requests = await client.getAllRequests();

  const seenOverseerrIds = new Set<number>();

  for (const req of requests) {
    const overseerrId = req.media?.id ?? req.id;
    seenOverseerrIds.add(overseerrId);

    const tmdbId = req.media?.tmdbId || null;
    const tvdbId = req.media?.tvdbId || null;
    const ratingKey = req.media?.ratingKey || null;
    const mediaType = req.type;

    let title = `Unknown (${mediaType}: ${tmdbId || tvdbId})`;
    let posterPath: string | null = null;
    let imdbId: string | null = null;
    let seasonCount: number | null = null;
    let availableSeasonCount: number | null = null;
    let requestedByPlexId: string | null = null;

    if (tmdbId) {
      try {
        const details = await client.getMediaDetails(tmdbId, mediaType);
        title =
          details.title || details.name || details.originalTitle || details.originalName || title;
        posterPath = details.posterPath || null;
        imdbId = details.imdbId || details.externalIds?.imdbId || null;
        if (mediaType === "tv") {
          seasonCount = details.numberOfSeasons || null;
          const seasons = details.mediaInfo?.seasons;
          if (seasons && seasons.length > 0) {
            availableSeasonCount = seasons.filter((s) => s.status >= 4).length || null;
          }
        }
      } catch {}
    }

    if (req.requestedBy?.plexId) {
      requestedByPlexId = String(req.requestedBy.plexId);
      await upsertUser({
        plexId: requestedByPlexId,
        username:
          req.requestedBy.plexUsername ||
          req.requestedBy.username ||
          req.requestedBy.email ||
          "Unknown",
        email: req.requestedBy.email || null,
        avatarUrl: req.requestedBy.avatar || null,
      });
    }

    const payload = {
      overseerrId,
      overseerrRequestId: req.id,
      tmdbId: tmdbId ?? undefined,
      tvdbId: tvdbId ?? undefined,
      imdbId: imdbId ?? undefined,
      mediaType,
      title,
      posterPath: posterPath ?? undefined,
      status: mapMediaStatus(req.media?.status),
      requestedByPlexId: requestedByPlexId ?? undefined,
      requestedAt: req.createdAt ?? undefined,
      ratingKey: ratingKey ?? undefined,
      inPlex: ratingKey ? true : undefined,
      seasonCount: seasonCount ?? undefined,
      availableSeasonCount: availableSeasonCount ?? undefined,
      inOverseerr: true,
      lastSyncedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Upsert logic: Try by overseerrId, then by tmdbId/tvdbId, then by ratingKey
    const byOverseerrId = await db
      .select()
      .from(mediaItems)
      .where(eq(mediaItems.overseerrId, overseerrId))
      .limit(1);
    if (byOverseerrId.length > 0) {
      await db.update(mediaItems).set(payload).where(eq(mediaItems.id, byOverseerrId[0].id));
    } else if (tmdbId || tvdbId) {
      const byExtId = await db
        .select()
        .from(mediaItems)
        .where(
          mediaType === "movie" && tmdbId
            ? eq(mediaItems.tmdbId, tmdbId)
            : mediaType === "tv" && tvdbId
              ? eq(mediaItems.tvdbId, tvdbId)
              : eq(mediaItems.id, -1) // Unreachable fallback
        )
        .limit(1);

      if (byExtId.length > 0) {
        await db.update(mediaItems).set(payload).where(eq(mediaItems.id, byExtId[0].id));
      } else if (ratingKey) {
        const byRatingKey = await db
          .select()
          .from(mediaItems)
          .where(eq(mediaItems.ratingKey, ratingKey))
          .limit(1);
        if (byRatingKey.length > 0) {
          await db.update(mediaItems).set(payload).where(eq(mediaItems.id, byRatingKey[0].id));
        } else {
          // It doesn't match anything. We just insert it (inOverseerr: true, inPlex: false)
          await db.insert(mediaItems).values({ ...payload, inPlex: false, inSonarrRadarr: false });
        }
      } else {
        await db.insert(mediaItems).values({ ...payload, inPlex: false, inSonarrRadarr: false });
      }
    } else {
      await db.insert(mediaItems).values({ ...payload, inPlex: false, inSonarrRadarr: false });
    }
    synced++;
  }

  // Clear inOverseerr for items no longer requested
  syncLogger.info("Layer 3 - Overseerr", "Cleaning up old Overseerr items...");
  const existingRequests = await db
    .select()
    .from(mediaItems)
    .where(eq(mediaItems.inOverseerr, true));
  for (const item of existingRequests) {
    if (item.overseerrId && !seenOverseerrIds.has(item.overseerrId)) {
      await db.update(mediaItems).set({ inOverseerr: false }).where(eq(mediaItems.id, item.id));
    }
  }

  return synced;
}

export async function runFullSync(onProgress?: ProgressCallback): Promise<{ itemsSynced: number }> {
  const logEntry = await db
    .insert(syncLog)
    .values({
      syncType: "full",
      status: "running",
      currentLayer: 1,
      progressMessage: "Starting sync...",
    })
    .returning();

  const logId = logEntry[0].id;
  let totalItemsSynced = 0;

  const updateProgress = async (layer: number, msg: string) => {
    await db
      .update(syncLog)
      .set({ currentLayer: layer, progressMessage: msg })
      .where(eq(syncLog.id, logId));
  };

  try {
    syncLogger.clear();
    syncLogger.info("Sync", "=================================================");
    syncLogger.info("Sync", "Starting 3-Layer library sync operation");

    // LAYER 1: Plex via Tautulli (opt-in)
    const plexEnabled = await isPlexSyncEnabled();
    if (plexEnabled) {
      await updateProgress(1, "Syncing Plex (Tautulli) data...");
      const plexItems = await syncLayer1Plex(logId, onProgress);
      totalItemsSynced += plexItems;
    } else {
      syncLogger.info(
        "Sync",
        "Layer 1 (Plex) skipped — Plex Library Sync is disabled in settings."
      );
    }

    // LAYER 2: Sonarr & Radarr
    await updateProgress(2, "Syncing Sonarr and Radarr...");
    const arrItems = await syncLayer2Arr(logId, onProgress);
    totalItemsSynced += arrItems;

    // LAYER 3: Overseerr
    await updateProgress(3, "Syncing Overseerr Requests...");
    const overseerrItems = await syncLayer3Overseerr(logId, onProgress);
    totalItemsSynced += overseerrItems;

    await db
      .update(syncLog)
      .set({
        status: "completed",
        itemsSynced: totalItemsSynced,
        currentLayer: 3,
        progressMessage: "Sync completed successfully.",
        completedAt: new Date().toISOString(),
      })
      .where(eq(syncLog.id, logId));

    syncLogger.info(
      "Sync",
      `Completed full sync perfectly. Synced total ${totalItemsSynced} entities.`
    );
    syncLogger.info("Sync", "=================================================\n");

    return { itemsSynced: totalItemsSynced };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    syncLogger.error("Sync", `Sync failed critically: ${errorMsg}`);
    await db
      .update(syncLog)
      .set({
        status: "failed",
        errors: JSON.stringify({ message: errorMsg }),
        completedAt: new Date().toISOString(),
      })
      .where(eq(syncLog.id, logId));

    throw err;
  }
}
