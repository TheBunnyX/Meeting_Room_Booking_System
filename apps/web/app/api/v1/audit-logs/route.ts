import { NextResponse } from "next/server";

import { parseQuery, route } from "@/lib/server/route";
import { requireRoles } from "@/lib/server/security";
import { auditLogRead } from "@/lib/server/serializers";
import { listAuditLogs } from "@/lib/server/services/operations";
import { auditQuerySchema } from "@/lib/server/validation";

export const GET = route(async (request) => {
  await requireRoles(request, "ADMIN");
  const { limit, offset, entity } = parseQuery(request, auditQuerySchema);
  const logs = await listAuditLogs(limit, offset, entity);
  return NextResponse.json(logs.map((log) => auditLogRead(log, log.user)));
});
