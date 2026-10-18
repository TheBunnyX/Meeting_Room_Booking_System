import { NextResponse } from "next/server";

import { route } from "@/lib/server/route";
import { requireRoles } from "@/lib/server/security";
import { bookingRead } from "@/lib/server/serializers";
import { listPending } from "@/lib/server/services/bookings";

export const GET = route(async (request) => {
  await requireRoles(request, "ADMIN", "FACILITY_ADMIN");
  return NextResponse.json((await listPending()).map(bookingRead));
});
