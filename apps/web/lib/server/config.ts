// Values shipped in the repository; never acceptable outside local development.
const PLACEHOLDER_SECRETS = new Set([
  "development-only-secret-change-me",
  "change-this-development-secret-to-a-long-random-value",
  "replace-me",
]);
const DEVELOPMENT_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3002", "http://127.0.0.1:3002"];

export type AppEnv = "development" | "test" | "production";

function integer(name: string, fallback: number) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

function appEnv(): AppEnv {
  const explicit = process.env.APP_ENV;
  if (explicit === "development" || explicit === "test" || explicit === "production") return explicit;
  if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") return "production";
  return process.env.NODE_ENV === "test" ? "test" : "development";
}

function load() {
  const env = appEnv();
  const isProduction = env === "production";
  const secretKey = process.env.SECRET_KEY ?? "";
  if (!secretKey) throw new Error("SECRET_KEY is not set");
  if (isProduction && (PLACEHOLDER_SECRETS.has(secretKey) || secretKey.length < 32)) {
    throw new Error("SECRET_KEY must be a unique random value of at least 32 characters in production");
  }
  const facilityTimezone = process.env.FACILITY_TIMEZONE || "Asia/Bangkok";
  try {
    new Intl.DateTimeFormat("en", { timeZone: facilityTimezone });
  } catch {
    throw new Error(`FACILITY_TIMEZONE is not a known timezone: ${facilityTimezone}`);
  }
  const extra = (process.env.EXTRA_CORS_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const origins = [process.env.FRONTEND_ORIGIN, ...extra].filter((item): item is string => Boolean(item));
  if (!isProduction) origins.push(...DEVELOPMENT_ORIGINS);
  return {
    appEnv: env,
    isProduction,
    secretKey,
    secretIsPlaceholder: PLACEHOLDER_SECRETS.has(secretKey),
    // Browser origins allowed to send state-changing requests besides the site's own origin.
    allowedOrigins: [...new Set(origins)],
    accessTokenExpireMinutes: integer("ACCESS_TOKEN_EXPIRE_MINUTES", 480),
    sessionCookieName: process.env.SESSION_COOKIE_NAME || "meetinghub_session",
    sessionCookieDomain: process.env.SESSION_COOKIE_DOMAIN || undefined,
    // Room opening hours and "today" are wall-clock times in this timezone.
    facilityTimezone,
    // Minimum seconds between status sweeps triggered by traffic. 0 disables the traffic trigger.
    statusSweepIntervalSeconds: integer("STATUS_SWEEP_INTERVAL_SECONDS", 60),
    // Public demo: the daily cron wipes all data back to the seed.
    demoMode: process.env.DEMO_MODE === "true",
    cronSecret: process.env.CRON_SECRET ?? "",
    loginMaxAttempts: integer("LOGIN_MAX_ATTEMPTS", 5),
    loginWindowMinutes: integer("LOGIN_WINDOW_MINUTES", 15),
  };
}

export type Config = ReturnType<typeof load>;

let cached: Config | undefined;

/** Read lazily so `next build` can import route modules without runtime secrets being present. */
export function getConfig(): Config {
  return (cached ??= load());
}

/** Tests change the environment between cases. */
export function resetConfigForTests() {
  cached = undefined;
}
