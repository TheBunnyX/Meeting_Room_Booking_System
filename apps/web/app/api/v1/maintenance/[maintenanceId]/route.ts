import { NextResponse } from "next/server";

import { parseId, route } from "@/lib/server/route";
import { requireRoles } from "@/lib/server/security";
import { removeMaintenance } from "@/lib/server/services/operations";

export const DELETE = route<{ maintenanceId: string }>(async (request, { maintenanceId }) => {
  const actor = await requireRoles(request, "ADMIN", "FACILITY_ADMIN");
  await removeMaintenance(actor, parseId(maintenanceId, "maintenance_id"));
  return NextResponse.json({ message: "Maintenance record removed" });
});
