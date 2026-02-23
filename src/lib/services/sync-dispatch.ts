import { runFullSync } from "./sync";
import type { SyncProgress } from "./sync";

// In-process lock — valid because Shelflife runs as a single long-lived Node.js
// process with SQLite (which is single-process by design). Not suitable for
// serverless or multi-instance deployments.
let isSyncing = false;

export function isSyncInProgress(): boolean {
  return isSyncing;
}

export async function dispatchSync(_type: string, onProgress?: (progress: SyncProgress) => void) {
  if (isSyncing) {
    throw new Error("A sync is already in progress");
  }

  isSyncing = true;
  try {
    return await runFullSync(onProgress);
  } finally {
    isSyncing = false;
  }
}
