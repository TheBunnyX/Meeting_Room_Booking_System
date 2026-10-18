import { timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";

import { getConfig } from "./config";
import { AppError } from "./errors";

/** Cron endpoints are public URLs, so they refuse everything that lacks the shared secret. */
export function requireCronSecret(request: NextRequest) {
  const secret = getConfig().cronSecret;
  if (!secret) throw new AppError(503, "CRON_NOT_CONFIGURED", "CRON_SECRET is not set");
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new AppError(401, "UNAUTHENTICATED", "Invalid cron credentials");
  }
}
