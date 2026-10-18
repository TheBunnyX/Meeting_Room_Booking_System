import { NextResponse } from "next/server";

import { parseId, route } from "@/lib/server/route";
import { currentUser } from "@/lib/server/security";
import { checkInRead } from "@/lib/server/serializers";
import { checkIn } from "@/lib/server/services/bookings";

export const POST = route<{ bookingId: string }>(async (request, { bookingId }) => {
  const user = await currentUser(request);
  const { booking, created } = await checkIn(user, parseId(bookingId, "booking_id"));
  return NextResponse.json(checkInRead(booking, created));
});
