// Seed demo data: npm run db:seed
import { db } from "../lib/server/db";
import { seed } from "../lib/server/services/seed";

async function main() {
  // Demo accounts have well-known passwords, so they only belong in development or a public demo.
  const production = process.env.APP_ENV === "production" || process.env.VERCEL_ENV === "production";
  if (production && process.env.DEMO_MODE !== "true") {
    throw new Error("Refusing to seed demo accounts with known passwords in production (set DEMO_MODE=true for a demo).");
  }
  await seed(db);
  console.log("Demo data is ready.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
