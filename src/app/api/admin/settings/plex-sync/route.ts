import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAuthError } from "@/lib/auth/middleware";
import { isPlexSyncEnabled, setPlexSyncEnabled } from "@/lib/services/settings";

export async function GET() {
  try {
    await requireAdmin();
    const enabled = await isPlexSyncEnabled();
    return NextResponse.json({ enabled });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireAdmin();

    const body = await request.json();
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }

    await setPlexSyncEnabled(body.enabled);
    return NextResponse.json({ enabled: body.enabled });
  } catch (error) {
    return handleAuthError(error);
  }
}
