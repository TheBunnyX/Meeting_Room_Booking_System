// Print a password hash for data/db.json:  node scripts/hash-password.mjs "the password"
// Same format as lib/local/password.ts (PBKDF2-SHA256), so the browser can verify it.
import { pbkdf2Sync, randomBytes } from "node:crypto";

export const ITERATIONS = 100_000;

export function hashPassword(password, iterations = ITERATIONS) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  return `pbkdf2-sha256$${iterations}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/").split("/").pop())) {
  const password = process.argv[2];
  if (!password) {
    console.error('Usage: node scripts/hash-password.mjs "the password"');
    process.exit(1);
  }
  console.log(hashPassword(password));
}
