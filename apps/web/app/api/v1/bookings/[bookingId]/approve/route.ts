import { NextResponse } from "next/server";

import { parseId, route } from "@/lib/server/route";
import { requireRoles } from "@/lib/server/security";
import { bookingRead } from "@/lib/server/serializers";
import { decideBooking } from "@/lib/server/services/bookings";

export const POST = route<{ bookingId: string }>(async (request, { bookingId }) => {
  const actor = await requireRoles(request, "ADMIN", "FACILITY_ADMIN");
  return NextResponse.json(bookingRead(await decideBooking(actor, parseId(bookingId, "booking_id"), true)));
});
