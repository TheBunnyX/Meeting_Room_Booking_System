import { execFileSync } from "node:child_process";

import { startTestDatabase, type TestDatabase } from "./postgres";

let database: TestDatabase | undefined;

// Starts a throwaway PostgreSQL, applies the real Prisma migrations, and exposes it to the test
// workers. Set TEST_DATABASE_URL to use an existing database instead (it is wiped by the tests).
export async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? (database = await startTestDatabase()).url;
  process.env.DATABASE_URL = url;
  process.env.APP_ENV = "test";
  process.env.SECRET_KEY = "test-secret-key-that-is-long-enough-for-hs256-signing";
  process.env.CRON_SECRET = "test-cron-secret";
  process.env.STATUS_SWEEP_INTERVAL_SECONDS = "0";
  process.env.FACILITY_TIMEZONE = "Asia/Bangkok";
  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: process.env,
    stdio: "pipe",
    shell: process.platform === "win32",
  });
}

export async function teardown() {
  await database?.stop();
}
