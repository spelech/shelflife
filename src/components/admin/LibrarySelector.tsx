"use client";

import { useState, useEffect } from "react";
import { Toast, type ToastData } from "@/components/ui/Toast";

interface Library {
  id: string;
  name: string;
  type: string;
}

export function LibrarySelector() {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings/libraries")
      .then((res) => res.json())
      .then((data) => {
        if (data.libraries) {
          setLibraries(data.libraries);
          setSelectedIds(data.selectedIds || []);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (newSelectedIds: string[]) => {
    setSaving(true);
    setToast(null);
    try {
      const res = await fetch("/api/admin/settings/libraries", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedIds: newSelectedIds }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSelectedIds(newSelectedIds);
      setToast({ message: "Library selection saved", type: "success" });
    } catch {
      setToast({ message: "Failed to save library selection", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const toggleLibrary = (id: string) => {
    let newSelection: string[];
    if (selectedIds.length === 0) {
      // If empty (meaning "all" is implicitly selected), moving from "all" means
      // we must explicitly select everything except the one we just toggled off.
      newSelection = libraries.map((l) => l.id).filter((lId) => lId !== id);
    } else {
      if (selectedIds.includes(id)) {
        newSelection = selectedIds.filter((lId) => lId !== id);
      } else {
        newSelection = [...selectedIds, id];
      }
    }

    // If all available libraries end up selected, empty the array to represent "All"
    // This allows robust handling if they add a new library later in Plex.
    if (newSelection.length === libraries.length) {
      newSelection = [];
    }

    handleSave(newSelection);
  };

  const setAllLibraries = () => {
    if (selectedIds.length === 0) return; // Already "all"
    handleSave([]);
  };

  if (loading) {
    return <div className="h-32 animate-pulse rounded-lg bg-gray-900" />;
  }

  if (libraries.length === 0) {
    return null; // Tautulli unavailable or no libraries
  }

  return (
    <div className="space-y-4 rounded-lg border border-gray-800 bg-gray-900 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">Plex Libraries to Sync</h3>
          <p className="mt-0.5 text-sm text-gray-400">
            Select which libraries should be included. If none are individually selected, all
            available libraries will be synced by default.
          </p>
        </div>
        <button
          onClick={setAllLibraries}
          disabled={saving || selectedIds.length === 0}
          className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700 hover:text-white disabled:opacity-50"
        >
          Select All
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {libraries.map((lib) => {
          const isSelected = selectedIds.length === 0 || selectedIds.includes(lib.id);
          return (
            <button
              key={lib.id}
              type="button"
              disabled={saving}
              onClick={() => toggleLibrary(lib.id)}
              className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                isSelected
                  ? "border-brand bg-brand/10 border"
                  : "border-gray-700 bg-gray-800 hover:border-gray-600 hover:bg-gray-700"
              }`}
            >
              <div
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                  isSelected ? "border-brand bg-brand" : "border-gray-500 bg-transparent"
                }`}
              >
                {isSelected && (
                  <svg
                    className="h-3.5 w-3.5 text-gray-900"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <div>
                <div
                  className={`font-medium ${isSelected ? "text-brand truncate font-bold" : "truncate text-gray-100"}`}
                >
                  {lib.name}
                </div>
                <div
                  className={`text-xs capitalize ${isSelected ? "text-brand/80" : "text-gray-400"}`}
                >
                  {lib.type}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
