import { NextResponse } from "next/server";

import { parseQuery, route } from "@/lib/server/route";
import { requireRoles } from "@/lib/server/security";
import { reportSummary } from "@/lib/server/services/operations";
import { periodOptionalQuerySchema } from "@/lib/server/validation";

// Booking statistics, optionally limited to bookings that start inside a period.
export const GET = route(async (request) => {
  await requireRoles(request, "ADMIN", "FACILITY_ADMIN");
  const { starts_at, ends_at } = parseQuery(request, periodOptionalQuerySchema);
  return NextResponse.json(await reportSummary(starts_at, ends_at));
});
