import { NextRequest } from "next/server";
import type { Booking, Room, User } from "@prisma/client";

import { db } from "../../lib/server/db";
import { hashPassword } from "../../lib/server/security";
import { seed } from "../../lib/server/services/seed";

type Handler = (request: NextRequest, context: { params: Promise<never> }) => Promise<Response>;

export type CallOptions = {
  method?: string;
  query?: Record<string, string | number | undefined>;
  json?: unknown;
  body?: BodyInit;
  cookie?: string;
  headers?: Record<string, string>;
  params?: Record<string, string | number>;
};

/** Invoke a route handler exactly as Next.js would, without starting a server. */
export async function call(handler: unknown, path: string, options: CallOptions = {}) {
  const url = new URL(path, "http://localhost:3000");
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const headers = new Headers(options.headers);
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.json !== undefined) headers.set("content-type", "application/json");
  const request = new NextRequest(url, {
    method: options.method ?? "GET",
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
  });
  const params = Promise.resolve(Object.fromEntries(Object.entries(options.params ?? {}).map(([k, v]) => [k, String(v)])));
  const response = await (handler as Handler)(request, { params: params as Promise<never> });
  // ignoreBOM keeps a leading byte-order mark, which Response.text() would strip.
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer());
  // Tests read arbitrary response shapes, so the parsed body is deliberately loose.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON (for example a CSV export): keep the raw text.
  }
  return { status: response.status, body, headers: response.headers };
}

const TABLES = [
  "users", "facilities", "rooms", '"_FacilityToRoom"', "bookings", "booking_participants", "maintenance",
  "check_ins", "notifications", "audit_logs", "rate_limit_events", "job_state",
];

/** Empty every table and restore the demo users and rooms. */
export async function resetDatabase() {
  await db.$executeRawUnsafe(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
  await seed(db);
}

export async function createUser(email: string, role: User["role"] = "USER", password = "Passw0rd!x", extra: Partial<User> = {}) {
  return db.user.create({
    data: { email, fullName: email.split("@")[0], role, passwordHash: await hashPassword(password), ...extra },
  });
}

/** Sign in through the real login route and return the session cookie. */
export async function signIn(loginHandler: unknown, email: string, password: string) {
  const response = await call(loginHandler, "/api/v1/auth/login", { method: "POST", json: { email, password } });
  if (response.status !== 200) throw new Error(`sign-in failed: ${JSON.stringify(response.body)}`);
  const setCookie = response.headers.get("set-cookie") ?? "";
  return setCookie.split(";")[0];
}

const pad = (n: number) => String(n).padStart(2, "0");

/** An ISO timestamp for `hour`:00 Bangkok time `daysAhead` days from today. */
export function slot(daysAhead: number, hour: number, minute = 0) {
  const base = new Date(Date.now() + daysAhead * 86_400_000 + 7 * 3_600_000);
  return `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(base.getUTCDate())}T${pad(hour)}:${pad(minute)}:00+07:00`;
}

export async function roomByName(name: string): Promise<Room> {
  return db.room.findFirstOrThrow({ where: { name } });
}

/** Insert a booking directly, bypassing the booking rules (for check-in and sweep tests). */
export async function insertBooking(data: Partial<Booking> & Pick<Booking, "roomId" | "organizerId" | "startsAt" | "endsAt">) {
  return db.booking.create({
    data: { title: "Direct booking", attendeeCount: 2, status: "CONFIRMED", ...data },
  });
}

