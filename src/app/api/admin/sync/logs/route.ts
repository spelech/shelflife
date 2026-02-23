import { NextResponse } from "next/server";
import { requireAdmin, handleAuthError } from "@/lib/auth/middleware";
import { syncLogger } from "@/lib/services/sync-logger";

export async function GET() {
  try {
    await requireAdmin();
    const logs = syncLogger.getLogs();
    return NextResponse.json({ logs });
  } catch (error) {
    return handleAuthError(error);
  }
}
