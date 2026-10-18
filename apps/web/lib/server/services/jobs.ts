import { getConfig } from "../config";
import { db } from "../db";
import { removeAllRoomImages } from "../blob";
import { runInBackground } from "../route";
import { sweepStatuses } from "./bookings";
import { forgotPasswordLimiter, loginLimiter } from "./rateLimit";
import { seed } from "./seed";

// Table names are fixed here, never taken from user input.
const ALL_TABLES = [
  "users",
  "facilities",
  "rooms",
  '"_FacilityToRoom"',
  "bookings",
  "booking_participants",
  "maintenance",
  "check_ins",
  "notifications",
  "audit_logs",
  "rate_limit_events",
];

/**
 * Atomically claim a run of a named job. Returns true for exactly one caller per interval, so a
 * cron tick and traffic-triggered sweeps on different instances never run the same job at once.
 */
export async function claimJob(name: string, minIntervalSeconds: number) {
  const claimed = await db.$executeRaw`
    INSERT INTO job_state (name, last_run_at) VALUES (${name}, now())
    ON CONFLICT (name) DO UPDATE SET last_run_at = now()
    WHERE job_state.last_run_at < now() - make_interval(secs => ${minIntervalSeconds}::double precision)`;
  return claimed > 0;
}

/** Run the status sweep from cron or on demand, regardless of when it last ran. */
export async function runStatusSweep() {
  await db.$executeRaw`
    INSERT INTO job_state (name, last_run_at) VALUES ('status-sweep', now())
    ON CONFLICT (name) DO UPDATE SET last_run_at = now()`;
  const result = await sweepStatuses();
  if (result.noShows || result.completed || result.reminders) {
    console.info(`Status sweep: ${result.noShows} no-show, ${result.completed} completed, ${result.reminders} reminders`);
  }
  return result;
}

/**
 * Vercel Cron on the Hobby plan runs at most once a day, so traffic keeps check-in reminders and
 * no-show handling timely: any signed-in request may trigger a sweep, at most once per interval.
 */
export function sweepInBackground() {
  const interval = getConfig().statusSweepIntervalSeconds;
  if (interval <= 0) return;
  runInBackground(async () => {
    if (await claimJob("status-sweep", interval)) await sweepStatuses();
  });
}

/** Delete everything people created and restore the seed users, rooms and equipment. */
export async function resetDemo() {
  await db.$executeRawUnsafe(`TRUNCATE ${ALL_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
  await seed(db);
  await removeAllRoomImages();
  await Promise.all([loginLimiter.clear(), forgotPasswordLimiter.clear()]);
  console.info("Demo data was reset to its starting state");
}
