import { NextResponse } from "next/server";

import { route } from "@/lib/server/route";
import { authenticatedUser, clearSessionCookie } from "@/lib/server/security";
import { revokeSessions } from "@/lib/server/services/users";

export const POST = route(async (request) => {
  const user = await authenticatedUser(request);
  await revokeSessions(user);
  const response = NextResponse.json({ message: "Signed out." });
  clearSessionCookie(response);
  return response;
});
