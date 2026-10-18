import { NextResponse } from "next/server";

import { parseQuery, route } from "@/lib/server/route";
import { currentUser } from "@/lib/server/security";
import { bookingRead } from "@/lib/server/serializers";
import { listMyBookings } from "@/lib/server/services/bookings";
import { sweepInBackground } from "@/lib/server/services/jobs";
import { pageQuerySchema } from "@/lib/server/validation";

export const GET = route(async (request) => {
  const user = await currentUser(request);
  const { limit, offset } = parseQuery(request, pageQuerySchema);
  const bookings = await listMyBookings(user, limit, offset);
  sweepInBackground();
  return NextResponse.json(bookings.map(bookingRead));
});
