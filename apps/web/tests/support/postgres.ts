import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import EmbeddedPostgres from "embedded-postgres";

async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

export type TestDatabase = { url: string; stop: () => Promise<void> };

/** A throwaway PostgreSQL server in a temp directory, so integration tests need no installed database. */
export async function startTestDatabase(): Promise<TestDatabase> {
  const directory = mkdtempSync(join(tmpdir(), "meetinghub-pg-"));
  const port = await freePort();
  const server = new EmbeddedPostgres({
    databaseDir: directory,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await server.initialise();
  await server.start();
  await server.createDatabase("meeting_booking");
  return {
    url: `postgresql://postgres:postgres@127.0.0.1:${port}/meeting_booking`,
    stop: async () => {
      await server.stop();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
