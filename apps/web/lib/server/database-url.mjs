// Finds the PostgreSQL connection string in the environment. A plain .mjs file so both the Next.js
// server code and the Node build script (scripts/vercel-build.mjs) share one implementation.

const DIRECT_URL = /^postgres(ql)?:\/\//;
// Checked first, in this order. POSTGRES_URL is what the Vercel Prisma Postgres integration provides.
const PREFERRED = ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "POSTGRES_PRISMA_URL"];

/**
 * The direct postgres:// connection string, or undefined. Also accepts variables the Vercel integration
 * created with a custom prefix, such as STORAGE_POSTGRES_URL or MYAPP_DATABASE_URL.
 * The prisma+postgres:// (Accelerate) URL is never returned: this app uses the direct connection.
 */
export function resolveDatabaseUrl(env = process.env) {
  for (const name of PREFERRED) {
    if (DIRECT_URL.test(env[name] ?? "")) return env[name];
  }
  for (const [name, value] of Object.entries(env)) {
    if (/(^|_)(POSTGRES|DATABASE)_URL$/.test(name) && DIRECT_URL.test(value ?? "")) return value;
  }
  return undefined;
}

/** Names (never values) of database-looking variables, to make a "not configured" message useful. */
export function describeDatabaseVariables(env = process.env) {
  return Object.entries(env)
    .filter(([name, value]) => value && /DATABASE|POSTGRES|PG_|NEON|SUPABASE/i.test(name))
    .map(([name, value]) => (value.startsWith("prisma+postgres://") ? `${name} (prisma+postgres://, not supported)` : name));
}
