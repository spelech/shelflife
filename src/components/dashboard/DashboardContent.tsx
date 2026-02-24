"use client";

import { useState, useCallback, useRef } from "react";
import { UserStats } from "./UserStats";
import { MediaGrid } from "../media/MediaGrid";
import { ReviewStatusBanner } from "../ui/ReviewStatusBanner";
import type { VoteValue } from "@/types";

interface DashboardContentProps {
  totalItems: number;
  nominatedCount: number;
  notNominatedCount: number;
  watchedCount: number;
  movieCount: number;
  tvCount: number;
  totalFileSize: number;
  inPlexCount: number;
  missingCount: number;
  pendingCount: number;
}

export function DashboardContent({
  totalItems: initialTotal,
  nominatedCount: initialNominated,
  notNominatedCount: initialNotNominated,
  watchedCount: initialWatched,
  movieCount: initialMovieCount,
  tvCount: initialTvCount,
  totalFileSize: initialTotalFileSize,
  inPlexCount: initialInPlexCount,
  missingCount: initialMissingCount,
  pendingCount: initialPendingCount,
}: DashboardContentProps) {
  const [statsFilter, setStatsFilter] = useState<string | null>(null);
  const [source, setSource] = useState("my_requests");
  const [stats, setStats] = useState({
    total: initialTotal,
    nominated: initialNominated,
    notNominated: initialNotNominated,
    watched: initialWatched,
    movieCount: initialMovieCount,
    tvCount: initialTvCount,
    totalFileSize: initialTotalFileSize,
    inPlexCount: initialInPlexCount,
    missingCount: initialMissingCount,
    pendingCount: initialPendingCount,
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const statsVersionRef = useRef(0);

  const fetchStats = useCallback(async (newSource: string) => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const versionAtStart = statsVersionRef.current;

    try {
      const res = await fetch(`/api/media/stats?source=${newSource}`, {
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        // Only apply if no votes occurred during the fetch
        if (statsVersionRef.current === versionAtStart) {
          setStats({
            total: data.total,
            nominated: data.nominated,
            notNominated: data.notNominated,
            watched: data.watched,
            movieCount: data.movieCount,
            tvCount: data.tvCount,
            totalFileSize: data.totalFileSize,
            inPlexCount: data.inPlexCount,
            missingCount: data.missingCount,
            pendingCount: data.pendingCount,
          });
        }
      }
    } catch {
      // Keep existing stats on error (including abort)
    }
  }, []);

  const handleSourceChange = useCallback(
    (newSource: string) => {
      setSource(newSource);
      setStatsFilter(null);
      fetchStats(newSource);
    },
    [fetchStats]
  );

  const handleVoteChange = useCallback(
    (_itemId: number, oldVote: VoteValue | null, newVote: VoteValue | null) => {
      statsVersionRef.current++;
      setStats((prev) => {
        const next = { ...prev };
        const wasNominated = oldVote === "delete" || oldVote === "trim";
        const isNominated = newVote === "delete" || newVote === "trim";

        if (wasNominated && !isNominated) {
          next.nominated--;
          next.notNominated++;
        } else if (!wasNominated && isNominated) {
          next.nominated++;
          next.notNominated--;
        }

        return next;
      });
    },
    []
  );

  return (
    <>
      <ReviewStatusBanner mode="nominating" />
      <UserStats
        totalItems={stats.total}
        nominatedCount={stats.nominated}
        notNominatedCount={stats.notNominated}
        watchedCount={stats.watched}
        movieCount={stats.movieCount}
        tvCount={stats.tvCount}
        totalFileSize={stats.totalFileSize}
        inPlexCount={stats.inPlexCount}
        missingCount={stats.missingCount}
        pendingCount={stats.pendingCount}
        activeFilter={statsFilter}
        onFilterChange={setStatsFilter}
      />
      <div>
        <h2 className="mb-4 text-lg font-semibold">
          {source === "my_requests" && "Your Requests"}
          {source === "all_requests" && "All Requests"}
          {source === "my_media" && "My Activity"}
          {source === "unrequested" && "Plex Direct"}
          {source === "all_media" && "Everything"}
        </h2>
        <MediaGrid
          statsFilter={statsFilter}
          onVoteChange={handleVoteChange}
          source={source}
          onSourceChange={handleSourceChange}
        />
      </div>
    </>
  );
}
