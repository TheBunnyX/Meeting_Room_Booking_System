import { NextResponse } from "next/server";
import type { User } from "@prisma/client";

import { userRead } from "./serializers";
import { createToken, setSessionCookie } from "./security";

/** A signed-in response: the token for API clients and the HTTP-only cookie for browsers. */
export async function startSession(user: User) {
  const token = await createToken(user);
  const response = NextResponse.json({ access_token: token, token_type: "bearer", user: userRead(user) });
  setSessionCookie(response, token);
  return response;
}
