import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

// ── Plex Library Sync Toggle ──────────────────────────────────────────
const PLEX_SYNC_KEY = "plex_sync_enabled";

export async function isPlexSyncEnabled(): Promise<boolean> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, PLEX_SYNC_KEY));
  return rows.length > 0 && rows[0].value === "true";
}

export async function setPlexSyncEnabled(enabled: boolean): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(appSettings)
    .values({ key: PLEX_SYNC_KEY, value: String(enabled), updatedAt: now })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: String(enabled), updatedAt: now },
    });
}

// ── Selected Library IDs ──────────────────────────────────────────────
// Stored as a JSON array of section_id strings.
// An empty array means "sync all libraries" (default / backwards-compatible).
const SELECTED_LIBRARIES_KEY = "selected_library_ids";

export async function getSelectedLibraries(): Promise<string[]> {
  const rows = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, SELECTED_LIBRARIES_KEY));
  if (rows.length === 0) return [];
  try {
    const parsed = JSON.parse(rows[0].value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function setSelectedLibraries(sectionIds: string[]): Promise<void> {
  const now = new Date().toISOString();
  const value = JSON.stringify(sectionIds);
  await db
    .insert(appSettings)
    .values({ key: SELECTED_LIBRARIES_KEY, value, updatedAt: now })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: now },
    });
}

// ── Sync Schedule Settings ────────────────────────────────────────────
export interface SyncScheduleSettings {
  enabled: boolean;
  schedule: string;
  syncType: "overseerr" | "tautulli" | "full";
}

const DEFAULTS: SyncScheduleSettings = {
  enabled: false,
  schedule: "0 */6 * * *",
  syncType: "full",
};

const SETTING_KEYS = {
  enabled: "sync_schedule_enabled",
  schedule: "sync_schedule_cron",
  syncType: "sync_schedule_type",
} as const;

const VALID_SYNC_TYPES = new Set<string>(["overseerr", "tautulli", "full"]);

export async function getSyncScheduleSettings(): Promise<SyncScheduleSettings> {
  const rows = await db
    .select()
    .from(appSettings)
    .where(inArray(appSettings.key, Object.values(SETTING_KEYS)));
  const lookup = new Map(rows.map((r) => [r.key, r.value]));

  const rawSyncType = lookup.get(SETTING_KEYS.syncType);

  return {
    enabled: lookup.get(SETTING_KEYS.enabled) === "true",
    schedule: lookup.get(SETTING_KEYS.schedule) || DEFAULTS.schedule,
    syncType:
      rawSyncType && VALID_SYNC_TYPES.has(rawSyncType)
        ? (rawSyncType as SyncScheduleSettings["syncType"])
        : DEFAULTS.syncType,
  };
}

export async function updateSyncScheduleSettings(
  settings: SyncScheduleSettings
): Promise<SyncScheduleSettings> {
  const now = new Date().toISOString();

  const entries = [
    { key: SETTING_KEYS.enabled, value: String(settings.enabled) },
    { key: SETTING_KEYS.schedule, value: settings.schedule },
    { key: SETTING_KEYS.syncType, value: settings.syncType },
  ];

  for (const entry of entries) {
    await db
      .insert(appSettings)
      .values({ key: entry.key, value: entry.value, updatedAt: now })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: entry.value, updatedAt: now },
      });
  }

  return settings;
}
