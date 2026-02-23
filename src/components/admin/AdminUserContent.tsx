"use client";

import { useState } from "react";
import { UserStats } from "../dashboard/UserStats";
import { AdminUserMedia } from "./AdminUserMedia";

interface AdminUserContentProps {
  plexId: string;
  totalItems: number;
  activeItems?: number;
  nominatedCount: number;
  notNominatedCount: number;
  watchedCount: number;
}

export function AdminUserContent({
  plexId,
  totalItems,
  activeItems,
  nominatedCount,
  notNominatedCount,
  watchedCount,
}: AdminUserContentProps) {
  const [statsFilter, setStatsFilter] = useState<string | null>(null);

  return (
    <>
      <UserStats
        totalItems={totalItems}
        activeItems={activeItems}
        nominatedCount={nominatedCount}
        notNominatedCount={notNominatedCount}
        watchedCount={watchedCount}
        activeFilter={statsFilter}
        onFilterChange={setStatsFilter}
      />
      <div>
        <h2 className="mb-4 text-lg font-semibold">Requests</h2>
        <AdminUserMedia plexId={plexId} statsFilter={statsFilter} />
      </div>
    </>
  );
}
