import { NextResponse } from "next/server";

import { parseBody, parseId, route } from "@/lib/server/route";
import { requireRoles } from "@/lib/server/security";
import { bookingRead } from "@/lib/server/serializers";
import { decideBooking } from "@/lib/server/services/bookings";
import { rejectSchema } from "@/lib/server/validation";

export const POST = route<{ bookingId: string }>(async (request, { bookingId }) => {
  const actor = await requireRoles(request, "ADMIN", "FACILITY_ADMIN");
  const id = parseId(bookingId, "booking_id");
  const { reason } = await parseBody(request, rejectSchema);
  return NextResponse.json(bookingRead(await decideBooking(actor, id, false, reason)));
});
