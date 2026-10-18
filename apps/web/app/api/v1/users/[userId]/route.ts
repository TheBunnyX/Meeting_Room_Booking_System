import { NextResponse } from "next/server";

import { parseBody, parseId, route } from "@/lib/server/route";
import { requireRoles } from "@/lib/server/security";
import { userRead } from "@/lib/server/serializers";
import { updateUser } from "@/lib/server/services/users";
import { userUpdateSchema } from "@/lib/server/validation";

export const PATCH = route<{ userId: string }>(async (request, { userId }) => {
  const actor = await requireRoles(request, "ADMIN");
  const id = parseId(userId, "user_id");
  const payload = await parseBody(request, userUpdateSchema);
  return NextResponse.json(userRead(await updateUser(actor, id, payload)));
});
