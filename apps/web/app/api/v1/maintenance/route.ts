import { NextResponse } from "next/server";

import { parseBody, route } from "@/lib/server/route";
import { requireRoles } from "@/lib/server/security";
import { maintenanceRead } from "@/lib/server/serializers";
import { createMaintenance, listMaintenance } from "@/lib/server/services/operations";
import { maintenanceInputSchema } from "@/lib/server/validation";

export const GET = route(async (request) => {
  await requireRoles(request, "ADMIN", "FACILITY_ADMIN");
  return NextResponse.json((await listMaintenance()).map(maintenanceRead));
});

export const POST = route(async (request) => {
  const actor = await requireRoles(request, "ADMIN", "FACILITY_ADMIN");
  const payload = await parseBody(request, maintenanceInputSchema);
  return NextResponse.json(maintenanceRead(await createMaintenance(actor, payload)), { status: 201 });
});
