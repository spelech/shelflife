"use client";

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

interface UserStatsProps {
  totalItems: number;
  activeItems?: number;
  nominatedCount: number;
  notNominatedCount: number;
  watchedCount: number;
  movieCount: number;
  tvCount: number;
  totalFileSize: number;
  inPlexCount: number;
  missingCount: number;
  pendingCount: number;
  activeFilter?: string | null;
  onFilterChange?: (filter: string | null) => void;
}

export function UserStats({
  totalItems,
  activeItems,
  nominatedCount,
  notNominatedCount,
  watchedCount,
  movieCount,
  tvCount,
  totalFileSize,
  inPlexCount,
  missingCount,
  pendingCount,
  activeFilter,
  onFilterChange,
}: UserStatsProps) {
  const showActive = activeItems !== undefined && activeItems !== totalItems;
  const stats = [
    ...(showActive
      ? [
          { label: "Active Items", value: activeItems, color: "text-gray-100", filter: null },
          { label: "Total Items", value: totalItems, color: "text-gray-400", filter: null },
        ]
      : [{ label: "Total Items", value: totalItems, color: "text-gray-100", filter: null }]),
    { label: "Nominated", value: nominatedCount, color: "text-red-400", filter: "nominated" },
    { label: "Not Nominated", value: notNominatedCount, color: "text-green-400", filter: "none" },
    { label: "Watched", value: watchedCount, color: "text-purple-400", filter: "watched" },
  ];

  const details = [
    { label: "Movies", value: String(movieCount), icon: "🎬" },
    { label: "TV Shows", value: String(tvCount), icon: "📺" },
    { label: "In Plex", value: String(inPlexCount), icon: "▶" },
    ...(pendingCount > 0 ? [{ label: "Pending", value: String(pendingCount), icon: "⏳" }] : []),
    ...(missingCount > 0 ? [{ label: "Missing", value: String(missingCount), icon: "🔍" }] : []),
    ...(totalFileSize > 0
      ? [{ label: "Library Size", value: formatFileSize(totalFileSize), icon: "💾" }]
      : []),
  ];

  return (
    <div className="space-y-3">
      <div className={`grid grid-cols-2 gap-4 ${showActive ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
        {stats.map((stat) => {
          const isActive = activeFilter === stat.filter;
          return (
            <button
              key={stat.label}
              onClick={() => onFilterChange?.(isActive ? null : stat.filter)}
              className={`rounded-lg border bg-gray-900 p-4 text-left transition-colors ${
                isActive
                  ? "border-brand ring-brand/50 ring-1"
                  : "border-gray-800 hover:border-gray-600"
              }`}
            >
              <p className="text-xs tracking-wide text-gray-500 uppercase">{stat.label}</p>
              <p className={`mt-1 text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            </button>
          );
        })}
      </div>
      {totalItems > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-2.5">
          {details.map((d) => (
            <span key={d.label} className="flex items-center gap-1.5 text-sm text-gray-400">
              <span>{d.icon}</span>
              <span className="font-medium text-gray-300">{d.value}</span>
              <span>{d.label}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
