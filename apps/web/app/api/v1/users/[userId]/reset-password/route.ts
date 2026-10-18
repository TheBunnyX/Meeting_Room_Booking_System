import { NextResponse } from "next/server";

import { parseId, route } from "@/lib/server/route";
import { requireRoles } from "@/lib/server/security";
import { resetPassword } from "@/lib/server/services/users";

export const POST = route<{ userId: string }>(async (request, { userId }) => {
  const actor = await requireRoles(request, "ADMIN");
  const temporary = await resetPassword(actor, parseId(userId, "user_id"));
  return NextResponse.json({
    temporary_password: temporary,
    message: "Provide this temporary password securely; the user must change it after sign-in.",
  });
});
