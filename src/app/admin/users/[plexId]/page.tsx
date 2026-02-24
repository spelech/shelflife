import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { users, mediaItems, userVotes, watchStatus } from "@/lib/db/schema";
import { eq, and, count, countDistinct, inArray, ne, sql } from "drizzle-orm";
import { AdminUserContent } from "@/components/admin/AdminUserContent";

export default async function AdminUserPage({ params }: { params: Promise<{ plexId: string }> }) {
  const session = await getSession();
  if (!session?.isAdmin) redirect("/");

  const { plexId } = await params;

  // Get user info
  const [user] = await db.select().from(users).where(eq(users.plexId, plexId)).limit(1);

  if (!user) notFound();

  // Get stats — single query for totals and type/size breakdown
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
      missingCount:
        sql<number>`SUM(CASE WHEN ${mediaItems.inPlex} = 0 AND ${mediaItems.inSonarrRadarr} = 1 THEN 1 ELSE 0 END)`.as(
          "missing_count"
        ),
      pendingCount:
        sql<number>`SUM(CASE WHEN ${mediaItems.inPlex} = 0 AND ${mediaItems.inOverseerr} = 1 THEN 1 ELSE 0 END)`.as(
          "pending_count"
        ),
    })
    .from(mediaItems)
    .where(eq(mediaItems.requestedByPlexId, plexId));

  const [activeResult] = await db
    .select({ total: count() })
    .from(mediaItems)
    .where(and(eq(mediaItems.requestedByPlexId, plexId), ne(mediaItems.status, "removed")));

  const [nominatedResult] = await db
    .select({ total: countDistinct(userVotes.mediaItemId) })
    .from(userVotes)
    .innerJoin(mediaItems, eq(userVotes.mediaItemId, mediaItems.id))
    .where(
      and(eq(mediaItems.requestedByPlexId, plexId), inArray(userVotes.vote, ["delete", "trim"]))
    );

  const [watchedResult] = await db
    .select({ total: count() })
    .from(watchStatus)
    .where(and(eq(watchStatus.userPlexId, plexId), eq(watchStatus.watched, true)));

  const totalRequests = totalResult?.total || 0;
  const activeRequests = activeResult?.total || 0;
  const nominatedCount = nominatedResult?.total || 0;
  const notNominatedCount = activeRequests - nominatedCount;
  const watchedCount = watchedResult?.total || 0;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-4">
            <a href="/admin" className="text-gray-400 hover:text-gray-200">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </a>
            <div className="flex items-center gap-3">
              {user.avatarUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.avatarUrl} alt={user.username} className="h-8 w-8 rounded-full" />
              )}
              <div>
                <h1 className="text-xl font-bold">{user.username}</h1>
                <p className="text-sm text-gray-400">
                  {user.email || "No email"} {user.isAdmin && " \u00b7 Admin"}
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <a href="/admin" className="text-sm text-gray-400 hover:text-gray-200">
              Back to Admin
            </a>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8">
        <AdminUserContent
          plexId={plexId}
          totalItems={totalRequests}
          activeItems={activeRequests}
          nominatedCount={nominatedCount}
          notNominatedCount={notNominatedCount}
          watchedCount={watchedCount}
          movieCount={totalResult?.movieCount || 0}
          tvCount={totalResult?.tvCount || 0}
          totalFileSize={totalResult?.totalFileSize || 0}
          inPlexCount={totalResult?.inPlexCount || 0}
          missingCount={totalResult?.missingCount || 0}
          pendingCount={totalResult?.pendingCount || 0}
        />
      </main>
    </div>
  );
}
