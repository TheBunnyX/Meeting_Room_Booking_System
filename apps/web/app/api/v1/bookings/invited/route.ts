import { NextResponse } from "next/server";

import { route } from "@/lib/server/route";
import { currentUser } from "@/lib/server/security";
import { bookingRead } from "@/lib/server/serializers";
import { listInvited } from "@/lib/server/services/bookings";

export const GET = route(async (request) => {
  const user = await currentUser(request);
  return NextResponse.json((await listInvited(user)).map(bookingRead));
});
