"use client";

import { useState, useCallback, useRef, useEffect } from "react";
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

const SOURCES = [
  { id: "my_requests", label: "Your Requests" },
  { id: "all_requests", label: "All Requests" },
  { id: "my_media", label: "My Activity" },
  { id: "unrequested", label: "Plex Direct" },
  { id: "all_media", label: "Everything" },
];

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
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
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

  // Close custom dropdown if clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownOpen]);

  // [existing code continues below]
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
      setDropdownOpen(false);
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

  const currentLabel = SOURCES.find((s) => s.id === source)?.label ?? "Your Requests";

  return (
    <>
      <ReviewStatusBanner mode="nominating" />
      <div>
        <div ref={dropdownRef} className="relative z-20 mb-4 inline-block">
          <button
            type="button"
            onClick={() => setDropdownOpen((prev) => !prev)}
            title="Change which media you are viewing"
            className="focus-visible:ring-brand flex cursor-pointer items-center gap-2 rounded text-xl font-semibold tracking-tight ring-offset-2 ring-offset-gray-950 transition-colors outline-none hover:text-gray-300 focus-visible:ring-2"
          >
            {currentLabel}
            <svg
              className={`text-brand h-5 w-5 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          {dropdownOpen && (
            <div className="ring-opacity-5 absolute top-full left-0 mt-2 w-56 rounded-lg border border-gray-700 bg-gray-800 p-1 shadow-xl ring-1 ring-black">
              {SOURCES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => handleSourceChange(s.id)}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    source === s.id
                      ? "bg-brand/10 text-brand font-medium"
                      : "text-gray-200 hover:bg-gray-700"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <MediaGrid
          statsFilter={statsFilter}
          onVoteChange={handleVoteChange}
          source={source}
          statsComponent={
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
          }
        />
      </div>
    </>
  );
}
