import { NextResponse } from "next/server";

import { parseQuery, route } from "@/lib/server/route";
import { currentUser } from "@/lib/server/security";
import { roomOccupancy } from "@/lib/server/services/rooms";
import { periodRequiredQuerySchema } from "@/lib/server/validation";

export const GET = route(async (request) => {
  await currentUser(request);
  const { starts_at, ends_at } = parseQuery(request, periodRequiredQuerySchema);
  return NextResponse.json(await roomOccupancy(starts_at, ends_at));
});
