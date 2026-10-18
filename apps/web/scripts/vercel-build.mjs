// Build step used by Vercel (see vercel.json): generate the Prisma client, apply migrations, build Next.js.
import { spawnSync } from "node:child_process";

const env = { ...process.env };
// The Vercel Prisma Postgres integration provides POSTGRES_URL; use it when DATABASE_URL is not set.
env.DATABASE_URL ||= env.POSTGRES_URL;

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
  if (!env.DATABASE_URL) {
    console.error(
      [
        "",
        "Cannot apply database migrations: no database is configured.",
        "Add Prisma Postgres under Storage (it provides POSTGRES_URL), or set DATABASE_URL to a postgres:// connection string,",
        "for the Production environment, then redeploy.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
  if (env.DATABASE_URL.startsWith("prisma+postgres://")) {
    console.error(
      "\nDATABASE_URL is a prisma+postgres:// (Accelerate) URL. Use the direct postgres:// connection string (POSTGRES_URL).\n",
    );
    process.exit(1);
  }
  run("npx", ["prisma", "migrate", "deploy"]);
} else {
  console.log("Skipping database migrations on this preview deployment (set MIGRATE_PREVIEW=true to run them).");
}

run("npx", ["next", "build"]);
