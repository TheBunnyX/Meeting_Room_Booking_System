import { NextResponse } from "next/server";

import { parseId, route } from "@/lib/server/route";
import { currentUser } from "@/lib/server/security";
import { cancelSeries } from "@/lib/server/services/bookings";

export const POST = route<{ bookingId: string }>(async (request, { bookingId }) => {
  const user = await currentUser(request);
  return NextResponse.json({ cancelled: await cancelSeries(user, parseId(bookingId, "booking_id")) });
});
