import { NextResponse } from "next/server";

import { parseId, route } from "@/lib/server/route";
import { currentUser } from "@/lib/server/security";
import { bookingRead } from "@/lib/server/serializers";
import { cancelBooking } from "@/lib/server/services/bookings";

export const POST = route<{ bookingId: string }>(async (request, { bookingId }) => {
  const user = await currentUser(request);
  return NextResponse.json(bookingRead(await cancelBooking(user, parseId(bookingId, "booking_id"))));
});
