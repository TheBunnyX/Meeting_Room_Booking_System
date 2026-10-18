import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as me } from "@/app/api/v1/auth/me/route";
import { GET as ready } from "@/app/ready/route";
import { resetConfigForTests } from "@/lib/server/config";
import { toErrorResponse } from "@/lib/server/route";

import { call } from "../support/app";

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // These cases log on purpose; keep the test output readable.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  consoleError.mockRestore();
  resetConfigForTests();
});

describe("a misconfigured deployment", () => {
  it("answers 503 with a clear code instead of an anonymous 500, and logs the exact setting", async () => {
    const secret = process.env.SECRET_KEY;
    delete process.env.SECRET_KEY;
    resetConfigForTests();
    try {
      const response = await call(me, "/api/v1/auth/me");
      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe("SERVER_NOT_CONFIGURED");
      // Visitors are not told which setting is missing; the server log is.
      expect(JSON.stringify(response.body)).not.toContain("SECRET_KEY");
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("SECRET_KEY is not set"));
      const readiness = await call(ready, "/ready");
      expect(readiness.status).toBe(503);
      expect(readiness.body.error.code).toBe("SERVER_NOT_CONFIGURED");
    } finally {
      process.env.SECRET_KEY = secret;
    }
  });

  it("rejects a short or placeholder SECRET_KEY in production", async () => {
    const { APP_ENV, SECRET_KEY } = process.env;
    process.env.APP_ENV = "production";
    process.env.SECRET_KEY = "replace-me";
    resetConfigForTests();
    try {
      const response = await call(me, "/api/v1/auth/me");
      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe("SERVER_NOT_CONFIGURED");
    } finally {
      process.env.APP_ENV = APP_ENV;
      process.env.SECRET_KEY = SECRET_KEY;
    }
  });
});

describe("database setup problems", () => {
  const known = (code: string) => new Prisma.PrismaClientKnownRequestError("table does not exist", { code, clientVersion: "test" });

  it("report a missing table or an unreachable database as 503", async () => {
    for (const code of ["P2021", "P2022", "P1001"]) {
      const response = toErrorResponse(known(code));
      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe("DATABASE_UNAVAILABLE");
    }
    const initialization = new Prisma.PrismaClientInitializationError("cannot connect", "test");
    expect(toErrorResponse(initialization).status).toBe(503);
  });

  it("keep other failures as a generic 500 that leaks nothing", async () => {
    const response = toErrorResponse(known("P2002"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("table does not exist");
    expect(toErrorResponse(new Error("boom")).status).toBe(500);
  });
});
