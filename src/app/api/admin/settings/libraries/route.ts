import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAuthError } from "@/lib/auth/middleware";
import { getTautulliClient } from "@/lib/services/tautulli";
import { getSelectedLibraries, setSelectedLibraries } from "@/lib/services/settings";

export async function GET() {
  try {
    await requireAdmin();
    // Wrap Tautulli client creation & fetching in try/catch in case Tautulli isn't set up
    let validLibraries: Array<{ id: string; name: string; type: string }> = [];
    try {
      const client = getTautulliClient();
      const libraries = await client.getLibraries();

      // Filter to only movie / tv sections
      validLibraries = libraries
        .filter((l) => l.section_type === "movie" || l.section_type === "show")
        .map((l) => ({
          id: String(l.section_id),
          name: l.section_name || "Unknown",
          type: l.section_type || "Unknown",
        }));
    } catch {
      // Return empty list if Tautulli fails (e.g., connection issue or not configured)
    }

    const selectedIds = await getSelectedLibraries();

    return NextResponse.json({
      libraries: validLibraries,
      selectedIds,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireAdmin();
    const body = await request.json();

    if (!Array.isArray(body.selectedIds)) {
      return NextResponse.json({ error: "selectedIds must be an array" }, { status: 400 });
    }

    await setSelectedLibraries(body.selectedIds.map(String));
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleAuthError(error);
  }
}
