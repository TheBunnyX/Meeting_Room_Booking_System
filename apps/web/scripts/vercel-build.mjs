// Build step used by Vercel (see vercel.json): generate the Prisma client, apply migrations, build Next.js.
import { spawnSync } from "node:child_process";

import { describeDatabaseVariables, resolveDatabaseUrl } from "../lib/server/database-url.mjs";

const env = { ...process.env };
// Prisma reads DATABASE_URL; fill it from POSTGRES_URL or a prefixed variable from the Vercel integration.
const databaseUrl = resolveDatabaseUrl(env);
if (databaseUrl) env.DATABASE_URL = databaseUrl;

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", env, shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// A site that builds but answers every request with an error is worse than a failed build, so production
// deployments must have the settings the server needs at runtime.
if (env.VERCEL_ENV === "production") {
  const secret = env.SECRET_KEY ?? "";
  const placeholder = /^(change-this|replace-me|development-only)/.test(secret);
  if (secret.length < 32 || placeholder) {
    console.error(
      [
        "",
        "SECRET_KEY is missing, too short, or a placeholder for the Production environment.",
        "Add SECRET_KEY under Settings > Environment Variables (Production) with a unique random value of at least 32 characters:",
        "  node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
        "Then redeploy.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
  if (!env.CRON_SECRET) console.warn("Warning: CRON_SECRET is not set, so the scheduled jobs under /api/cron will be refused.");
  if (!env.BLOB_READ_WRITE_TOKEN) console.warn("Warning: BLOB_READ_WRITE_TOKEN is not set, so room image uploads will be unavailable.");
}

run("npx", ["prisma", "generate"]);

// Production deployments always migrate. Preview deployments only do when asked to, so a branch with an
// unreleased migration cannot change a database shared with production. Outside Vercel, always migrate.
const vercelEnv = env.VERCEL_ENV;
const migrate = !vercelEnv || vercelEnv === "production" || env.MIGRATE_PREVIEW === "true";

if (migrate) {
  if (!databaseUrl) {
    const found = describeDatabaseVariables(env);
    console.error(
      [
        "",
        `Cannot apply database migrations: no PostgreSQL connection string is available to this ${vercelEnv ?? "build"} environment.`,
        `Database-related variables found: ${found.length ? found.join(", ") : "none"}.`,
        "",
        "Fix: in Vercel open Settings > Environment Variables and make sure DATABASE_URL (or POSTGRES_URL from the Prisma Postgres",
        "integration) is set with a postgres:// value and is enabled for the Production environment. If the database was added",
        "under Storage, check that it is connected to this project for Production. Then redeploy.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
  run("npx", ["prisma", "migrate", "deploy"]);
} else {
  console.log("Skipping database migrations on this preview deployment (set MIGRATE_PREVIEW=true to run them).");
}

run("npx", ["next", "build"]);
