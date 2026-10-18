import { NextResponse } from "next/server";

import { parseQuery, route } from "@/lib/server/route";
import { currentUser } from "@/lib/server/security";
import { scheduleBookingRead } from "@/lib/server/serializers";
import { listSchedule } from "@/lib/server/services/bookings";
import { sweepInBackground } from "@/lib/server/services/jobs";
import { periodRequiredQuerySchema } from "@/lib/server/validation";

export const GET = route(async (request) => {
  await currentUser(request);
  const { starts_at, ends_at } = parseQuery(request, periodRequiredQuerySchema);
  const bookings = await listSchedule(starts_at, ends_at);
  sweepInBackground();
  return NextResponse.json(bookings.map(scheduleBookingRead));
});
