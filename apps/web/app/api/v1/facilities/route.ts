import { NextResponse } from "next/server";

import { route } from "@/lib/server/route";
import { currentUser } from "@/lib/server/security";
import { listFacilities } from "@/lib/server/services/rooms";

export const GET = route(async (request) => {
  await currentUser(request);
  return NextResponse.json((await listFacilities()).map(({ id, name }) => ({ id, name })));
});
