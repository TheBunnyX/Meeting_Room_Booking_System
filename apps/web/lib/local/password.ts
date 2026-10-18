// Password hashing in the browser with the Web Crypto API (PBKDF2-SHA256). Argon2 is not available there.
// Format: pbkdf2-sha256$<iterations>$<salt hex>$<hash hex>. scripts/hash-password.mjs makes the same format.

export const PBKDF2_ITERATIONS = 100_000;

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${iterations}$${toHex(salt)}$${toHex(await derive(password, salt, iterations))}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, rounds, salt, hash] = stored.split("$");
  const iterations = Number(rounds);
  if (scheme !== "pbkdf2-sha256" || !Number.isInteger(iterations) || iterations < 1 || !salt || !hash) return false;
  const derived = await derive(password, fromHex(salt), iterations);
  const expected = fromHex(hash);
  if (derived.length !== expected.length) return false;
  // Compare every byte so the time taken does not reveal where the first difference is.
  let difference = 0;
  for (let index = 0; index < derived.length; index += 1) difference |= derived[index] ^ expected[index];
  return difference === 0;
}

export function randomToken(bytes: number) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}
