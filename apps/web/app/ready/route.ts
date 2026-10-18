import { NextResponse } from "next/server";

import { db } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (error) {
    console.error("Readiness check failed", error);
    return errorResponse(503, "DATABASE_UNAVAILABLE", "The database is not reachable");
  }
  return NextResponse.json({ status: "ready" });
}
