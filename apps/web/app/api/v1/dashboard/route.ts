import { NextResponse } from "next/server";

import { route } from "@/lib/server/route";
import { requireRoles } from "@/lib/server/security";
import { dashboard } from "@/lib/server/services/operations";

export const GET = route(async (request) => {
  await requireRoles(request, "ADMIN", "FACILITY_ADMIN");
  return NextResponse.json(await dashboard());
});
