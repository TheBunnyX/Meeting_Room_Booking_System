import { NextResponse } from "next/server";

import { route } from "@/lib/server/route";
import { currentUser } from "@/lib/server/security";
import { policy } from "@/lib/server/services/bookings";

export const GET = route(async (request) => {
  await currentUser(request);
  return NextResponse.json(policy());
});
