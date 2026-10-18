import { NextResponse } from "next/server";

import { parseBody, parseId, route } from "@/lib/server/route";
import { currentUser } from "@/lib/server/security";
import { bookingRead } from "@/lib/server/serializers";
import { updateBooking } from "@/lib/server/services/bookings";
import { bookingUpdateSchema } from "@/lib/server/validation";

export const PATCH = route<{ bookingId: string }>(async (request, { bookingId }) => {
  const user = await currentUser(request);
  const id = parseId(bookingId, "booking_id");
  const payload = await parseBody(request, bookingUpdateSchema);
  return NextResponse.json(bookingRead(await updateBooking(user, id, payload)));
});
