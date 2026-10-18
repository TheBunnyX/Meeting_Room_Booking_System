import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function databaseUrl() {
  // The Vercel Prisma Postgres integration provides POSTGRES_URL (direct) next to PRISMA_DATABASE_URL.
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (url?.startsWith("prisma+postgres://")) {
    throw new Error(
      "DATABASE_URL is a prisma+postgres:// (Accelerate) URL. Use the direct postgres:// connection string, POSTGRES_URL on Vercel.",
    );
  }
  return url;
}

// One client per server instance; reused across hot reloads in development.
export const db = (globalForPrisma.prisma ??= new PrismaClient({ datasourceUrl: databaseUrl() }));

/** Either the shared client or the client of an open transaction. */
export type Db = PrismaClient | Prisma.TransactionClient;

export function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export const OVERLAP_CONSTRAINT = "bookings_no_overlap";

/** The exclusion constraint that forbids two active bookings for one room from overlapping. */
export function isOverlapViolation(error: unknown) {
  if (!(error instanceof Error)) return false;
  const meta = JSON.stringify((error as { meta?: unknown }).meta ?? "");
  return `${error.message} ${meta}`.includes(OVERLAP_CONSTRAINT);
}
