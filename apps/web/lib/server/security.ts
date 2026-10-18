import { hash, verify } from "@node-rs/argon2";
import { type Role, type User } from "@prisma/client";
import { SignJWT, errors, jwtVerify } from "jose";
import { NextResponse, type NextRequest } from "next/server";

import { getConfig } from "./config";
import { db } from "./db";
import { AppError } from "./errors";

// Argon2id with the library defaults; hashes created by the previous Python backend still verify.
export const hashPassword = (password: string) => hash(password);

export async function verifyPassword(password: string, hashed: string) {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

const key = () => new TextEncoder().encode(getConfig().secretKey);

export async function createToken(user: Pick<User, "id" | "tokenVersion">) {
  const { accessTokenExpireMinutes } = getConfig();
  return new SignJWT({ ver: user.tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setExpirationTime(`${accessTokenExpireMinutes}m`)
    .sign(key());
}

function cookieOptions() {
  const config = getConfig();
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax" as const,
    domain: config.sessionCookieDomain,
    path: "/",
  };
}

export function setSessionCookie(response: NextResponse, token: string) {
  const config = getConfig();
  response.cookies.set(config.sessionCookieName, token, {
    ...cookieOptions(),
    maxAge: config.accessTokenExpireMinutes * 60,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(getConfig().sessionCookieName, "", { ...cookieOptions(), maxAge: 0 });
}

/** Browsers authenticate with the HTTP-only session cookie; API clients may send a bearer token. */
function tokenFrom(request: NextRequest) {
  const header = request.headers.get("authorization");
  if (header) {
    const [scheme, value] = header.split(" ");
    if (scheme?.toLowerCase() === "bearer" && value) return value;
  }
  return request.cookies.get(getConfig().sessionCookieName)?.value;
}

/** Resolve the signed-in user, including one who still has to replace a temporary password. */
export async function authenticatedUser(request: NextRequest): Promise<User> {
  const token = tokenFrom(request);
  if (!token) throw new AppError(401, "UNAUTHENTICATED", "Sign in to continue");
  let userId: number;
  let version: number;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    userId = Number(payload.sub);
    version = Number(payload.ver ?? 0);
    if (!Number.isInteger(userId) || !Number.isInteger(version)) throw new Error("bad claims");
  } catch {
    throw new AppError(401, "UNAUTHENTICATED", "Invalid or expired session");
  }
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive || user.tokenVersion !== version) {
    throw new AppError(401, "UNAUTHENTICATED", "Invalid or expired session");
  }
  return user;
}

export async function currentUser(request: NextRequest): Promise<User> {
  const user = await authenticatedUser(request);
  if (user.mustChangePassword) {
    throw new AppError(403, "PASSWORD_CHANGE_REQUIRED", "Change your temporary password to continue");
  }
  return user;
}

export async function requireRoles(request: NextRequest, ...roles: Role[]): Promise<User> {
  const user = await currentUser(request);
  if (!roles.includes(user.role)) throw new AppError(403, "FORBIDDEN", "Insufficient permission");
  return user;
}

const CHECK_IN_TOKEN_TYPE = "room-check-in";
// Long enough to scan the code and, if needed, sign in first; short enough that a photo of the
// screen sent to someone elsewhere stops working almost immediately.
export const CHECK_IN_TOKEN_LIFETIME_SECONDS = 120;

/** A signed code for one room. The screen at the room shows it as a QR code and keeps renewing it. */
export function createCheckInToken(roomId: number, lifetimeSeconds = CHECK_IN_TOKEN_LIFETIME_SECONDS) {
  return new SignJWT({ typ: CHECK_IN_TOKEN_TYPE, room: roomId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(Math.floor(Date.now() / 1000) + lifetimeSeconds)
    .sign(key());
}

/** Accept only an unexpired code that was issued for this room. */
export async function verifyCheckInToken(token: string, roomId: number) {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    // Session tokens are signed with the same key, so the type and room must match as well.
    if (payload.typ !== CHECK_IN_TOKEN_TYPE || payload.room !== roomId) throw new Error("wrong code");
  } catch (error) {
    if (error instanceof errors.JWTExpired) {
      throw new AppError(
        400,
        "CHECK_IN_CODE_EXPIRED",
        "This code has expired. Scan the code on the screen at the room again.",
      );
    }
    throw new AppError(
      400,
      "CHECK_IN_CODE_INVALID",
      "This code is not valid. Scan the code on the screen at the room.",
    );
  }
}
