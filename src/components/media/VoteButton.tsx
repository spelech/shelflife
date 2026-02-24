"use client";

import { useState, useEffect } from "react";
import type { VoteValue } from "@/types";

interface VoteButtonProps {
  mediaItemId: number;
  currentVote: VoteValue | null;
  seasonCount?: number | null;
  mediaType?: "movie" | "tv";
  currentKeepSeasons?: number | null;
  currentComment?: string | null;
  onVoteChange?: (newVote: VoteValue | null, oldVote: VoteValue | null) => void;
}

export function VoteButton({
  mediaItemId,
  currentVote,
  seasonCount,
  mediaType,
  currentKeepSeasons,
  currentComment,
  onVoteChange,
}: VoteButtonProps) {
  const [vote, setVote] = useState<VoteValue | null>(currentVote);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keepSeasons, setKeepSeasons] = useState<number>(currentKeepSeasons || 1);
  const [comment, setComment] = useState<string>(currentComment || "");
  const [isEditingComment, setIsEditingComment] = useState(false);
  const [showTrimSelector, setShowTrimSelector] = useState(false);

  useEffect(() => {
    setVote(currentVote);
  }, [currentVote]);

  useEffect(() => {
    if (currentKeepSeasons != null) {
      setKeepSeasons(currentKeepSeasons);
    }
  }, [currentKeepSeasons]);

  useEffect(() => {
    if (currentComment !== undefined) {
      setComment(currentComment || "");
    }
  }, [currentComment]);

  const canTrim = mediaType === "tv" && seasonCount && seasonCount > 1;
  const isNominated = vote === "delete" || vote === "trim";

  const handleNominate = async () => {
    if (isNominated) {
      // Un-nominate via DELETE
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/media/${mediaItemId}/vote`, {
          method: "DELETE",
        });
        if (res.ok) {
          const oldVote = vote;
          setVote(null);
          setComment("");
          setIsEditingComment(false);
          setShowTrimSelector(false);
          onVoteChange?.(null, oldVote);
        } else {
          const body = await res.json().catch(() => null);
          setError(body?.error || "Failed. Try again.");
        }
      } catch (err) {
        console.error("Failed to un-nominate:", err);
        setError("Failed. Try again.");
      } finally {
        setLoading(false);
      }
    } else {
      // Nominate for deletion via POST
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/media/${mediaItemId}/vote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vote: "delete", comment: comment || undefined }),
        });
        if (res.ok) {
          const oldVote = vote;
          setVote("delete");
          onVoteChange?.("delete", oldVote);
        } else {
          const body = await res.json().catch(() => null);
          setError(body?.error || "Failed. Try again.");
        }
      } catch (err) {
        console.error("Failed to nominate:", err);
        setError("Failed. Try again.");
      } finally {
        setLoading(false);
      }
    }
  };

  const handleTrim = async (seasons: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/media/${mediaItemId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote: "trim", keepSeasons: seasons, comment: comment || undefined }),
      });
      if (res.ok) {
        const oldVote = vote;
        setVote("trim");
        setKeepSeasons(seasons);
        setShowTrimSelector(false);
        onVoteChange?.("trim", oldVote);
      } else {
        const body = await res.json().catch(() => null);
        setError(body?.error || "Failed. Try again.");
      }
    } catch (err) {
      console.error("Failed to set trim:", err);
      setError("Failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveComment = async () => {
    if (!vote) return;
    setLoading(true);
    setError(null);
    try {
      const payload: { vote: VoteValue; comment?: string; keepSeasons?: number } = {
        vote,
        comment: comment || undefined,
      };
      if (vote === "trim") payload.keepSeasons = keepSeasons;

      const res = await fetch(`/api/media/${mediaItemId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setIsEditingComment(false);
      } else {
        const body = await res.json().catch(() => null);
        setError(body?.error || "Failed to save comment.");
      }
    } catch (err) {
      console.error("Failed to save comment:", err);
      setError("Failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        onClick={handleNominate}
        disabled={loading}
        className={`w-full rounded-md px-3 py-2 text-sm font-medium transition-colors ${
          vote === "trim"
            ? "bg-amber-600 text-white"
            : vote === "delete"
              ? "bg-red-600 text-white"
              : "bg-gray-800 text-gray-300 hover:bg-gray-700"
        } disabled:opacity-50`}
      >
        {vote === "trim"
          ? `Trim: keep latest ${keepSeasons} season${keepSeasons !== 1 ? "s" : ""}`
          : vote === "delete"
            ? "Nominated for Deletion"
            : "Nominate for Deletion"}
      </button>
      {canTrim && isNominated && (
        <>
          <button
            onClick={() => setShowTrimSelector(!showTrimSelector)}
            disabled={loading}
            className="w-full text-center text-xs text-amber-400 hover:text-amber-300 disabled:opacity-50"
          >
            {vote === "trim" ? "Change trim settings" : "Trim seasons instead?"}
          </button>
          {showTrimSelector && (
            <div className="flex items-center gap-2 rounded-md bg-gray-800 p-2">
              <label className="text-xs whitespace-nowrap text-gray-400">Keep latest</label>
              <input
                type="number"
                min={1}
                max={seasonCount - 1}
                value={keepSeasons}
                onChange={(e) =>
                  setKeepSeasons(Math.max(1, Math.min(seasonCount - 1, Number(e.target.value))))
                }
                className="w-14 rounded border border-gray-600 bg-gray-900 px-2 py-1 text-center text-sm text-gray-200"
              />
              <span className="text-xs text-gray-400">of {seasonCount}</span>
              <button
                onClick={() => handleTrim(keepSeasons)}
                disabled={loading}
                className="ml-auto rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-50"
              >
                Apply
              </button>
            </div>
          )}
        </>
      )}

      {isNominated && (
        <div className="mt-2 border-t border-gray-800 pt-2 text-sm">
          {isEditingComment ? (
            <div className="space-y-2">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add an optional comment..."
                className="w-full resize-none rounded border border-gray-600 bg-gray-900 p-2 text-gray-200 placeholder-gray-500 focus:border-amber-500 focus:outline-none"
                rows={2}
                maxLength={500}
                disabled={loading}
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setComment(currentComment || "");
                    setIsEditingComment(false);
                  }}
                  disabled={loading}
                  className="rounded px-2 py-1 text-xs text-gray-400 hover:text-gray-300"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveComment}
                  disabled={loading}
                  className="rounded bg-gray-700 px-3 py-1 text-xs font-medium text-white hover:bg-gray-600 disabled:opacity-50"
                >
                  Save Comment
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-2 rounded bg-gray-800/50 p-2">
              <p className="text-xs text-gray-400">
                {comment ? (
                  <span className="leading-relaxed break-words whitespace-pre-wrap text-gray-300">
                    {comment}
                  </span>
                ) : (
                  <span className="text-gray-500 italic">No comment provided</span>
                )}
              </p>
              <button
                onClick={() => setIsEditingComment(true)}
                className="shrink-0 text-xs text-amber-400 hover:text-amber-300"
              >
                {comment ? "Edit" : "Add comment"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
