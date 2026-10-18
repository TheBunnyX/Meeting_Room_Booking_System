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
