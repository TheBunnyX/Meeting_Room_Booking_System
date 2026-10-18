import { NextResponse } from "next/server";

import { db } from "@/lib/server/db";
import { getConfig } from "@/lib/server/config";
import { errorResponse } from "@/lib/server/errors";
import { toErrorResponse } from "@/lib/server/route";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    getConfig();
  } catch (error) {
    return toErrorResponse(error);
  }
  try {
    // Reads a real table, so a database that is reachable but not migrated is reported too.
    await db.user.count({ take: 1 });
  } catch (error) {
    console.error("Readiness check failed", error);
    return errorResponse(503, "DATABASE_UNAVAILABLE", "The database is not reachable or has not been set up");
  }
  return NextResponse.json({ status: "ready" });
}
