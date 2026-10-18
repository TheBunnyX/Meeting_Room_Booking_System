// Local development database without Docker: npm run db:local
//
// Runs a real PostgreSQL (the embedded-postgres dev dependency) whose data is kept in
// apps/web/.local-db, so it survives restarts. Leave it running in its own terminal, then run
// `npm run db:migrate` and `npm run db:seed` once.
import { existsSync } from "node:fs";
import { join } from "node:path";

import EmbeddedPostgres from "embedded-postgres";

const PORT = Number(process.env.LOCAL_DB_PORT ?? 54329);
const DATABASE = "meeting_booking";
const directory = join(process.cwd(), ".local-db");

async function main() {
  const server = new EmbeddedPostgres({
    databaseDir: directory,
    user: "postgres",
    password: "postgres",
    port: PORT,
    persistent: true,
    onLog: () => {},
    onError: (message) => console.error(message),
  });
  if (!existsSync(join(directory, "PG_VERSION"))) await server.initialise();
  await server.start();
  try {
    await server.createDatabase(DATABASE);
  } catch {
    // The database already exists from an earlier run.
  }
  console.log(`PostgreSQL is running: postgresql://postgres:postgres@localhost:${PORT}/${DATABASE}`);
  console.log("Press Ctrl+C to stop it. Data is kept in apps/web/.local-db.");

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await server.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
