import { db } from "@/lib/db";
import {
  mediaItems,
  userVotes,
  watchStatus,
  users,
  communityVotes,
  reviewActions,
} from "@/lib/db/schema";
import { eq, and, count, or, ne, inArray, sql, type SQL } from "drizzle-orm";

const mediaItemColumns = {
  id: mediaItems.id,
  overseerrId: mediaItems.overseerrId,
  tmdbId: mediaItems.tmdbId,
  imdbId: mediaItems.imdbId,
  mediaType: mediaItems.mediaType,
  title: mediaItems.title,
  posterPath: mediaItems.posterPath,
  status: mediaItems.status,
  requestedAt: mediaItems.requestedAt,
  ratingKey: mediaItems.ratingKey,
  seasonCount: mediaItems.seasonCount,
  availableSeasonCount: mediaItems.availableSeasonCount,
  fileSize: mediaItems.fileSize,
  inPlex: mediaItems.inPlex,
  vote: userVotes.vote,
  keepSeasons: userVotes.keepSeasons,
  watched: watchStatus.watched,
  playCount: watchStatus.playCount,
  lastWatchedAt: watchStatus.lastWatchedAt,
};

export function mediaQueryWithJoins(plexId: string) {
  return db
    .select(mediaItemColumns)
    .from(mediaItems)
    .leftJoin(
      userVotes,
      and(eq(userVotes.mediaItemId, mediaItems.id), eq(userVotes.userPlexId, plexId))
    )
    .leftJoin(
      watchStatus,
      and(eq(watchStatus.mediaItemId, mediaItems.id), eq(watchStatus.userPlexId, plexId))
    );
}

export function mediaCountWithJoins(plexId: string) {
  return db
    .select({ total: count() })
    .from(mediaItems)
    .leftJoin(
      userVotes,
      and(eq(userVotes.mediaItemId, mediaItems.id), eq(userVotes.userPlexId, plexId))
    )
    .leftJoin(
      watchStatus,
      and(eq(watchStatus.mediaItemId, mediaItems.id), eq(watchStatus.userPlexId, plexId))
    );
}

export interface MediaItemRow {
  id: number;
  overseerrId: number | null;
  tmdbId: number | null;
  imdbId: string | null;
  mediaType: "movie" | "tv";
  title: string;
  posterPath: string | null;
  status:
    | "unknown"
    | "pending"
    | "processing"
    | "partial"
    | "available"
    | "removed"
    | "not_requested";
  requestedAt: string | null;
  ratingKey: string | null;
  seasonCount: number | null;
  availableSeasonCount: number | null;
  fileSize: number | null;
  inPlex: boolean;
  vote: "delete" | "trim" | null;
  keepSeasons: number | null;
  watched: boolean | null;
  playCount: number | null;
  lastWatchedAt: string | null;
}

export function mapMediaItemRow(i: MediaItemRow) {
  return {
    id: i.id,
    overseerrId: i.overseerrId,
    tmdbId: i.tmdbId,
    imdbId: i.imdbId,
    mediaType: i.mediaType,
    title: i.title,
    posterPath: i.posterPath,
    status: i.status,
    requestedAt: i.requestedAt,
    ratingKey: i.ratingKey,
    seasonCount: i.seasonCount || null,
    availableSeasonCount: i.availableSeasonCount || null,
    fileSize: i.fileSize ?? null,
    inPlex: i.inPlex,
    vote: i.vote || null,
    keepSeasons: i.keepSeasons || null,
    watchStatus:
      i.watched !== null
        ? {
            watched: i.watched,
            playCount: i.playCount || 0,
            lastWatchedAt: i.lastWatchedAt,
          }
        : null,
  };
}

/**
 * Shared condition for community nomination queries.
 * An item is nominated if someone voted delete/trim AND
 * the voter is the requestor OR the voter is an admin.
 */
export function getNominationCondition() {
  return and(
    eq(userVotes.mediaItemId, mediaItems.id),
    inArray(userVotes.vote, ["delete", "trim"]),
    or(
      eq(userVotes.userPlexId, mediaItems.requestedByPlexId),
      inArray(
        userVotes.userPlexId,
        db.select({ plexId: users.plexId }).from(users).where(eq(users.isAdmin, true))
      )
    )
  );
}

/**
 * Shared stats computation used by both the stats API endpoint
 * and the dashboard page server-side rendering.
 *
 * Status exclusion rules are aligned with the media API route:
 * - my_requests / all_requests / my_media: exclude 'removed' and 'not_requested'
 * - unrequested: no status exclusions (items are typically 'not_requested')
 * - all_media: exclude only 'removed' (matches grid's default status=all behavior)
 */
export async function computeMediaStats(plexId: string, source: string) {
  const conditions: SQL[] = [];
  if (source === "all_requests") {
    conditions.push(eq(mediaItems.inOverseerr, true));
  } else if (source === "my_requests") {
    conditions.push(
      and(eq(mediaItems.inOverseerr, true), eq(mediaItems.requestedByPlexId, plexId))!
    );
  } else if (source === "my_media") {
    conditions.push(or(eq(watchStatus.watched, true), eq(mediaItems.requestedByPlexId, plexId))!);
  } else if (source === "unrequested") {
    conditions.push(and(eq(mediaItems.inPlex, true), eq(mediaItems.inOverseerr, false))!);
  }

  // Status exclusions aligned with the media API route per source
  const statusExclusions: SQL[] = [];
  if (source === "unrequested") {
    // No status exclusions — unrequested items are typically 'not_requested'
  } else if (source === "all_media") {
    // Only exclude removed (matches grid's default status=all)
    statusExclusions.push(ne(mediaItems.status, "removed"));
  } else {
    // Request-based sources: exclude both removed and not_requested
    statusExclusions.push(ne(mediaItems.status, "removed"));
    statusExclusions.push(ne(mediaItems.status, "not_requested"));
  }

  const baseCondition =
    [...conditions, ...statusExclusions].length > 0
      ? and(...conditions, ...statusExclusions)
      : undefined;

  const [totalResult] = await db
    .select({
      total: count(),
      movieCount:
        sql<number>`SUM(CASE WHEN ${mediaItems.mediaType} = 'movie' THEN 1 ELSE 0 END)`.as(
          "movie_count"
        ),
      tvCount: sql<number>`SUM(CASE WHEN ${mediaItems.mediaType} = 'tv' THEN 1 ELSE 0 END)`.as(
        "tv_count"
      ),
      totalFileSize: sql<number>`COALESCE(SUM(${mediaItems.fileSize}), 0)`.as("total_file_size"),
      inPlexCount: sql<number>`SUM(CASE WHEN ${mediaItems.inPlex} = 1 THEN 1 ELSE 0 END)`.as(
        "in_plex_count"
      ),
    })
    .from(mediaItems)
    .leftJoin(
      watchStatus,
      and(eq(watchStatus.mediaItemId, mediaItems.id), eq(watchStatus.userPlexId, plexId))
    )
    .where(baseCondition);

  const [nominatedResult] = await db
    .select({ total: count() })
    .from(mediaItems)
    .innerJoin(
      userVotes,
      and(eq(userVotes.mediaItemId, mediaItems.id), eq(userVotes.userPlexId, plexId))
    )
    .leftJoin(
      watchStatus,
      and(eq(watchStatus.mediaItemId, mediaItems.id), eq(watchStatus.userPlexId, plexId))
    )
    .where(and(inArray(userVotes.vote, ["delete", "trim"]), baseCondition));

  const [watchedResult] = await db
    .select({ total: count() })
    .from(mediaItems)
    .innerJoin(
      watchStatus,
      and(eq(watchStatus.mediaItemId, mediaItems.id), eq(watchStatus.userPlexId, plexId))
    )
    .where(and(eq(watchStatus.watched, true), baseCondition));

  const total = totalResult?.total || 0;
  const nominated = nominatedResult?.total || 0;

  return {
    total,
    nominated,
    notNominated: total - nominated,
    watched: watchedResult?.total || 0,
    movieCount: totalResult?.movieCount || 0,
    tvCount: totalResult?.tvCount || 0,
    totalFileSize: totalResult?.totalFileSize || 0,
    inPlexCount: totalResult?.inPlexCount || 0,
  };
}

export function buildPagination(page: number, limit: number, total: number) {
  return {
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
  };
}

/**
 * Shared candidate query for review rounds.
 * Returns nominated media items with community vote tallies, admin actions,
 * and the acting admin's username.
 */
export async function getCandidatesForRound(roundId: number) {
  const keepVoterUser = db
    .select({ plexId: users.plexId, username: users.username })
    .from(users)
    .as("keep_voter_user");

  const keepTallySub = db
    .select({
      mediaItemId: communityVotes.mediaItemId,
      cnt: count().as("keep_count"),
      voterUsernames: sql<string>`GROUP_CONCAT(DISTINCT ${keepVoterUser.username})`.as(
        "voter_usernames"
      ),
    })
    .from(communityVotes)
    .innerJoin(keepVoterUser, eq(keepVoterUser.plexId, communityVotes.userPlexId))
    .where(eq(communityVotes.vote, "keep"))
    .groupBy(communityVotes.mediaItemId)
    .as("keep_tally");

  const actionSubquery = db
    .select({
      mediaItemId: reviewActions.mediaItemId,
      action: reviewActions.action,
      actedByPlexId: reviewActions.actedByPlexId,
      actedAt: reviewActions.actedAt,
    })
    .from(reviewActions)
    .where(eq(reviewActions.reviewRoundId, roundId))
    .as("round_action");

  const actionByUser = db
    .select({
      plexId: users.plexId,
      username: users.username,
    })
    .from(users)
    .as("action_by_user");

  const baseCondition = getNominationCondition();

  // Prefer self-nomination over admin nomination for type and keepSeasons
  const selfPreferredVote = sql<string>`COALESCE(
    MAX(CASE WHEN ${userVotes.userPlexId} = ${mediaItems.requestedByPlexId} THEN ${userVotes.vote} END),
    MAX(${userVotes.vote})
  )`.as("nomination_type");

  const selfPreferredKeepSeasons = sql<number | null>`COALESCE(
    MAX(CASE WHEN ${userVotes.userPlexId} = ${mediaItems.requestedByPlexId} THEN ${userVotes.keepSeasons} END),
    MAX(${userVotes.keepSeasons})
  )`.as("keep_seasons_agg");

  // Build a subquery to resolve nominator usernames
  const nominatorUser = db
    .select({
      plexId: users.plexId,
      username: users.username,
    })
    .from(users)
    .as("nominator_user");

  // Collect distinct nominator usernames (comma-separated if multiple)
  const nominatedByUsernames = sql<string>`GROUP_CONCAT(DISTINCT ${nominatorUser.username})`.as(
    "nominated_by_usernames"
  );

  return db
    .select({
      id: mediaItems.id,
      title: mediaItems.title,
      mediaType: mediaItems.mediaType,
      status: mediaItems.status,
      posterPath: mediaItems.posterPath,
      tmdbId: mediaItems.tmdbId,
      tvdbId: mediaItems.tvdbId,
      overseerrId: mediaItems.overseerrId,
      imdbId: mediaItems.imdbId,
      ratingKey: mediaItems.ratingKey,
      requestedByUsername: users.username,
      nominatedByUsernames,
      seasonCount: mediaItems.seasonCount,
      availableSeasonCount: mediaItems.availableSeasonCount,
      nominationType: selfPreferredVote,
      keepSeasons: selfPreferredKeepSeasons,
      keepCount: keepTallySub.cnt,
      keepVoterUsernames: keepTallySub.voterUsernames,
      action: actionSubquery.action,
      actedAt: actionSubquery.actedAt,
      actionByUsername: actionByUser.username,
      fileSize: mediaItems.fileSize,
      inPlex: mediaItems.inPlex,
      updatedAt: mediaItems.updatedAt,
    })
    .from(mediaItems)
    .innerJoin(userVotes, baseCondition!)
    .leftJoin(users, eq(users.plexId, mediaItems.requestedByPlexId))
    .leftJoin(nominatorUser, eq(nominatorUser.plexId, userVotes.userPlexId))
    .leftJoin(keepTallySub, eq(keepTallySub.mediaItemId, mediaItems.id))
    .leftJoin(actionSubquery, eq(actionSubquery.mediaItemId, mediaItems.id))
    .leftJoin(actionByUser, eq(actionByUser.plexId, actionSubquery.actedByPlexId))
    .groupBy(mediaItems.id)
    .orderBy(
      sql`CASE WHEN ${mediaItems.status} = 'removed' THEN 1 ELSE 0 END ASC`,
      sql`COALESCE(${keepTallySub.cnt}, 0) DESC`,
      mediaItems.mediaType,
      mediaItems.title
    );
}
