import { NextResponse } from "next/server";

import { parseBody, route } from "@/lib/server/route";
import { currentUser } from "@/lib/server/security";
import { bookingRead } from "@/lib/server/serializers";
import { createBooking } from "@/lib/server/services/bookings";
import { bookingInputSchema } from "@/lib/server/validation";

export const POST = route(async (request) => {
  const user = await currentUser(request);
  const payload = await parseBody(request, bookingInputSchema);
  return NextResponse.json(bookingRead(await createBooking(user, payload)), { status: 201 });
});
