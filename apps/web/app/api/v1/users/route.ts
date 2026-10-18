import { NextResponse } from "next/server";

import { parseBody, parseQuery, route } from "@/lib/server/route";
import { requireRoles } from "@/lib/server/security";
import { userRead } from "@/lib/server/serializers";
import { createUser, listUsers } from "@/lib/server/services/users";
import { pageQuerySchema, userCreateSchema } from "@/lib/server/validation";

export const GET = route(async (request) => {
  await requireRoles(request, "ADMIN");
  const { limit, offset } = parseQuery(request, pageQuerySchema);
  return NextResponse.json((await listUsers(limit, offset)).map(userRead));
});

export const POST = route(async (request) => {
  const actor = await requireRoles(request, "ADMIN");
  const payload = await parseBody(request, userCreateSchema);
  const { user, password } = await createUser(actor, payload);
  return NextResponse.json({ ...userRead(user), temporary_password: password }, { status: 201 });
});
