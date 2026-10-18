import { NextResponse, after, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";

import { Prisma } from "@prisma/client";
import { ConfigError, getConfig } from "./config";
import { AppError, errorResponse } from "./errors";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type Context<P> = { params: Promise<P> };

/**
 * Wrap a route handler so every failure leaves in the stable `{ error: { code, message, field } }`
 * shape, cookie-authenticated writes from foreign origins are refused, and nothing internal leaks.
 */
export function route<P = Record<string, never>>(
  handler: (request: NextRequest, params: P) => Promise<Response>,
) {
  return async (request: NextRequest, context: Context<P>): Promise<Response> => {
    try {
      rejectForeignOrigin(request);
      const response = await handler(request, await context.params);
      response.headers.set("X-Content-Type-Options", "nosniff");
      return response;
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

export function toErrorResponse(error: unknown) {
  let response: NextResponse;
  if (error instanceof AppError) {
    response = errorResponse(error.status, error.code, error.message, error.field, error.headers);
  } else if (error instanceof ZodError) {
    response = validationError(error);
  } else if (error instanceof ConfigError) {
    // The operator needs the exact setting, visitors do not: it goes to the server log only.
    console.error(`Server configuration error: ${error.message}`);
    response = errorResponse(
      503,
      "SERVER_NOT_CONFIGURED",
      "The server is not fully configured. Ask the administrator to check the deployment settings.",
    );
  } else if (isDatabaseSetupError(error)) {
    console.error("Database is unavailable or not migrated", error);
    response = errorResponse(
      503,
      "DATABASE_UNAVAILABLE",
      "The database is not reachable or has not been set up. Ask the administrator to check the deployment.",
    );
  } else {
    console.error("Unhandled error", error);
    response = errorResponse(500, "INTERNAL_ERROR", "Something went wrong on the server");
  }
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

/** Cannot connect, bad credentials, or a table/column that the migrations have not created. */
export function isDatabaseSetupError(error: unknown) {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  return error instanceof Prisma.PrismaClientKnownRequestError && ["P1001", "P1002", "P1017", "P2021", "P2022"].includes(error.code);
}

/**
 * CSRF defence for cookie sessions: a browser always sends Origin on state-changing cross-origin
 * requests, so reject any that do not come from this site or a configured frontend.
 */
function rejectForeignOrigin(request: NextRequest) {
  if (!UNSAFE_METHODS.has(request.method)) return;
  const origin = request.headers.get("origin");
  const config = getConfig();
  const usesCookie = request.cookies.has(config.sessionCookieName) && !request.headers.has("authorization");
  if (!origin || !usesCookie) return;
  if (origin === request.nextUrl.origin || config.allowedOrigins.includes(origin)) return;
  throw new AppError(403, "FORBIDDEN_ORIGIN", "This request origin is not allowed");
}

function validationError(error: ZodError) {
  const first = error.issues[0];
  const field = first.path.map(String).join(".") || null;
  return errorResponse(422, "VALIDATION_ERROR", first.message, field);
}

/** Validate a JSON body. Unknown properties are dropped, so clients cannot set fields they should not. */
export async function parseBody<T>(request: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError(422, "VALIDATION_ERROR", "The request body must be valid JSON");
  }
  return schema.parse(raw);
}

/** Validate the query string. */
export function parseQuery<T>(request: NextRequest, schema: ZodType<T>): T {
  return schema.parse(Object.fromEntries(request.nextUrl.searchParams));
}

/** Parse a numeric path segment; anything else is reported as a validation failure. */
export function parseId(value: string, field: string) {
  if (!/^\d{1,9}$/.test(value)) throw new AppError(422, "VALIDATION_ERROR", `${field} must be a number`, field);
  return Number(value);
}

/** Run follow-up work after the response is sent; falls back to fire-and-forget outside a request. */
export function runInBackground(task: () => Promise<unknown>) {
  const safe = () =>
    task().catch((error) => {
      console.error("Background task failed", error);
    });
  try {
    after(safe);
  } catch {
    void safe();
  }
}

/** Where the request came from, for rate limiting. Vercel sets x-forwarded-for itself. */
export function clientAddress(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || request.headers.get("x-real-ip") || "unknown").slice(0, 45);
}
