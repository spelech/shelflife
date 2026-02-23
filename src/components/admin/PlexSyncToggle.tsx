"use client";

import { useState } from "react";
import { Toast, type ToastData } from "@/components/ui/Toast";

interface PlexSyncToggleProps {
  initialEnabled: boolean;
}

export function PlexSyncToggle({ initialEnabled }: PlexSyncToggleProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);

  const handleToggle = async () => {
    const newValue = !enabled;
    setSaving(true);
    setToast(null);

    try {
      const res = await fetch("/api/admin/settings/plex-sync", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newValue }),
      });

      if (!res.ok) {
        const err = await res.json();
        setToast({ message: err.error || "Failed to save", type: "error" });
        return;
      }

      setEnabled(newValue);
      setToast({
        message: newValue
          ? "Plex Library Sync enabled — next sync will scan your full Plex library"
          : "Plex Library Sync disabled — sync will skip the Plex library scan",
        type: "success",
      });
    } catch {
      setToast({ message: "Failed to save setting", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-gray-800 bg-gray-900 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Plex Library Sync</h3>
          <p className="mt-0.5 text-sm text-gray-400">
            Scan your entire Plex library during sync to track all media, not just requested items.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={saving}
          onClick={handleToggle}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 disabled:opacity-50 ${
            enabled ? "bg-brand" : "bg-gray-700"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform duration-200 ${
              enabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>
      {enabled && (
        <p className="text-xs text-gray-500">
          ⚠️ This can add significant time to each sync depending on your library size. Items found
          only in Plex (not in Overseerr) will appear with a{" "}
          <span className="rounded bg-orange-900/80 px-1 py-0.5 text-orange-300">Plex</span> badge.
        </p>
      )}
      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
