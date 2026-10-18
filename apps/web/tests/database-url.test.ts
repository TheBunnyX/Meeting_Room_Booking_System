import { describe, expect, it } from "vitest";

import { describeDatabaseVariables, resolveDatabaseUrl } from "../lib/server/database-url.mjs";

const direct = "postgres://user:pw@db.prisma.io:5432/postgres?sslmode=require";

describe("resolveDatabaseUrl", () => {
  it("prefers DATABASE_URL, then POSTGRES_URL", () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: "postgresql://a/b", POSTGRES_URL: direct })).toBe("postgresql://a/b");
    expect(resolveDatabaseUrl({ POSTGRES_URL: direct })).toBe(direct);
  });

  it("finds the variable the Vercel integration created with a custom prefix", () => {
    expect(resolveDatabaseUrl({ STORAGE_POSTGRES_URL: direct })).toBe(direct);
    expect(resolveDatabaseUrl({ MYAPP_DATABASE_URL: direct })).toBe(direct);
  });

  it("never returns the Accelerate URL or unrelated values", () => {
    expect(resolveDatabaseUrl({ PRISMA_DATABASE_URL: "prisma+postgres://accelerate.prisma-data.net/?api_key=x" })).toBeUndefined();
    expect(resolveDatabaseUrl({ DATABASE_URL: "prisma+postgres://accelerate.prisma-data.net/?api_key=x", POSTGRES_URL: direct })).toBe(direct);
    expect(resolveDatabaseUrl({ DATABASE_URL: "not a url", SOMETHING: direct })).toBeUndefined();
    expect(resolveDatabaseUrl({})).toBeUndefined();
  });
});

describe("describeDatabaseVariables", () => {
  it("lists names only, never values, and flags the unsupported URL", () => {
    const names = describeDatabaseVariables({
      PRISMA_DATABASE_URL: "prisma+postgres://secret-host/?api_key=topsecret",
      POSTGRES_HOST: "db.prisma.io",
      PATH: "/usr/bin",
    });
    expect(names).toEqual(["PRISMA_DATABASE_URL (prisma+postgres://, not supported)", "POSTGRES_HOST"]);
    expect(JSON.stringify(names)).not.toContain("topsecret");
  });
});
