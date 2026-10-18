import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as demoResetCron } from "@/app/api/cron/demo-reset/route";
import { GET as sweepCron } from "@/app/api/cron/sweep/route";
import { GET as auditLogs } from "@/app/api/v1/audit-logs/route";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as dashboard } from "@/app/api/v1/dashboard/route";
import { POST as expireNoShows } from "@/app/api/v1/jobs/expire-no-shows/route";
import { DELETE as removeMaintenance } from "@/app/api/v1/maintenance/[maintenanceId]/route";
import { GET as listMaintenance, POST as createMaintenance } from "@/app/api/v1/maintenance/route";
import { GET as exportCsv } from "@/app/api/v1/reports/bookings.csv/route";
import { GET as reportSummary } from "@/app/api/v1/reports/summary/route";
import { GET as ready } from "@/app/ready/route";
import { GET as health } from "@/app/health/route";
import { db } from "@/lib/server/db";
import { claimJob, resetDemo } from "@/lib/server/services/jobs";
import { csvCell } from "@/lib/server/services/operations";
import { localIso, startOfLocalDay } from "@/lib/server/time";
import { resetConfigForTests } from "@/lib/server/config";

import { call, createUser, insertBooking, resetDatabase, roomByName, signIn, slot } from "../support/app";

const blob = vi.hoisted(() => ({
  put: vi.fn(),
  del: vi.fn(async () => undefined),
  list: vi.fn(async () => ({ blobs: [{ url: "https://s.public.blob.vercel-storage.com/rooms/a.png" }], hasMore: false })),
}));
vi.mock("@vercel/blob", () => blob);

let admin: string;
let user: string;
let studioId: number;
let userId: number;

beforeEach(async () => {
  await resetDatabase();
  blob.del.mockClear();
  admin = await signIn(login, "admin@meetinghub.com", "Admin123!");
  user = await signIn(login, "user@meetinghub.com", "User123!");
  studioId = (await roomByName("Studio 01")).id;
  userId = (await db.user.findUniqueOrThrow({ where: { email: "user@meetinghub.com" } })).id;
});

const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000);

describe("maintenance", () => {
  it("is managed by managers, validated, and audited", async () => {
    const payload = { room_id: studioId, starts_at: slot(2, 9), ends_at: slot(2, 12), reason: "Repaint" };
    expect((await call(createMaintenance, "/x", { method: "POST", cookie: user, json: payload })).status).toBe(403);
    const created = await call(createMaintenance, "/x", { method: "POST", cookie: admin, json: payload });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ room_name: "Studio 01", reason: "Repaint" });
    expect((await call(createMaintenance, "/x", { method: "POST", cookie: admin, json: { ...payload, room_id: 999 } })).status).toBe(404);
    const reversed = await call(createMaintenance, "/x", { method: "POST", cookie: admin, json: { ...payload, ends_at: slot(2, 8) } });
    expect(reversed.body.error.field).toBe("ends_at");
    expect((await call(listMaintenance, "/x", { cookie: admin })).body).toHaveLength(1);
    expect((await call(removeMaintenance, "/x", { method: "DELETE", cookie: admin, params: { maintenanceId: created.body.id } })).status).toBe(200);
    expect((await call(removeMaintenance, "/x", { method: "DELETE", cookie: admin, params: { maintenanceId: created.body.id } })).status).toBe(404);
    const actions = (await db.auditLog.findMany({ where: { entity: "Maintenance" }, orderBy: { id: "asc" } })).map((log) => log.action);
    expect(actions).toEqual(["CREATE", "DELETE"]);
  });
});

describe("dashboard and reports", () => {
  beforeEach(async () => {
    const day = startOfLocalDay(new Date()).getTime();
    const at = (hour: number) => new Date(day + hour * 3_600_000);
    const rooms = [studioId, (await roomByName("Focus Room")).id, (await roomByName("The Loft")).id];
    await insertBooking({ roomId: rooms[0], organizerId: userId, startsAt: at(9), endsAt: at(10) });
    await insertBooking({ roomId: rooms[0], organizerId: userId, status: "CANCELLED", startsAt: at(9), endsAt: at(10) });
    await insertBooking({ roomId: rooms[1], organizerId: userId, status: "NO_SHOW", startsAt: at(9), endsAt: at(10) });
    await insertBooking({ roomId: rooms[2], organizerId: userId, status: "REJECTED", startsAt: at(9), endsAt: at(10) });
  });

  it("counts today and totals for managers only", async () => {
    expect((await call(dashboard, "/x", { cookie: user })).status).toBe(403);
    const response = await call(dashboard, "/x", { cookie: admin });
    expect(response.body).toEqual({ bookings_today: 4, active_rooms: 6, cancelled_bookings: 1, no_shows: 1 });
  });

  it("summarises usage, ignoring requests that never held the room", async () => {
    const response = await call(reportSummary, "/x", { cookie: admin });
    expect(response.body).toMatchObject({
      total_bookings: 4, cancelled_bookings: 1, rejected_bookings: 1, no_show_bookings: 1, cancellation_rate: 25, no_show_rate: 25,
    });
    // A no-show still used the room; equal counts are ordered by name.
    expect(response.body.most_used_rooms.slice(0, 2)).toEqual([
      { room: "Focus Room", bookings: 1 },
      { room: "Studio 01", bookings: 1 },
    ]);
    expect(response.body.most_used_rooms).toHaveLength(5);
    const empty = await call(reportSummary, "/x", { cookie: admin, query: { starts_at: slot(10, 0), ends_at: slot(11, 0) } });
    expect(empty.body).toMatchObject({ total_bookings: 0, cancellation_rate: 0 });
    const reversed = await call(reportSummary, "/x", { cookie: admin, query: { starts_at: slot(11, 0), ends_at: slot(10, 0) } });
    expect(reversed.body.error.code).toBe("INVALID_TIME_RANGE");
  });

  it("exports CSV with a byte-order mark and without spreadsheet formulas", async () => {
    await insertBooking({
      roomId: studioId, organizerId: userId, title: "=HYPERLINK(\"http://evil\"),\"quoted\"", decisionNote: "ประชุมทีม",
      startsAt: new Date(slot(5, 10)), endsAt: new Date(slot(5, 11)),
    });
    expect((await call(exportCsv, "/x", { cookie: user })).status).toBe(403);
    const response = await call(exportCsv, "/x", { cookie: admin });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("bookings.csv");
    const text = response.body as string;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain("id,room,building,title,organizer");
    expect(text).toContain('"\'=HYPERLINK(""http://evil""),""quoted"""');
    expect(text).toContain("ประชุมทีม");
    expect(text).toMatch(/\+07:00/);
    expect(text.split("\r\n").filter(Boolean)).toHaveLength(6);
  });

  it("neutralises formula cells", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@x")).toBe("'@x");
    expect(csvCell("plain, text")).toBe('"plain, text"');
    expect(csvCell(null)).toBe("");
  });
});

describe("audit log", () => {
  it("is limited to administrators and can be filtered", async () => {
    await call(createMaintenance, "/x", {
      method: "POST", cookie: admin, json: { room_id: studioId, starts_at: slot(2, 9), ends_at: slot(2, 12), reason: "Repaint" },
    });
    expect((await call(auditLogs, "/x", { cookie: user })).status).toBe(403);
    await createUser("fac@meetinghub.com", "FACILITY_ADMIN");
    const facility = await signIn(login, "fac@meetinghub.com", "Passw0rd!x");
    expect((await call(auditLogs, "/x", { cookie: facility })).status).toBe(403);
    const all = await call(auditLogs, "/x", { cookie: admin });
    expect(all.body[0]).toMatchObject({ actor_email: "admin@meetinghub.com", action: "CREATE", entity: "Maintenance" });
    expect((await call(auditLogs, "/x", { cookie: admin, query: { entity: "Room" } })).body).toHaveLength(0);
    expect((await call(auditLogs, "/x", { cookie: admin, query: { limit: 500 } })).status).toBe(422);
  });
});

describe("status sweep", () => {
  it("reminds, marks no-shows and completes finished check-ins, exactly once", async () => {
    const reminder = await insertBooking({ roomId: studioId, organizerId: userId, startsAt: minutesFromNow(10), endsAt: minutesFromNow(70) });
    const missed = await insertBooking({ roomId: (await roomByName("Focus Room")).id, organizerId: userId, startsAt: minutesFromNow(-30), endsAt: minutesFromNow(30) });
    const finished = await insertBooking({
      roomId: (await roomByName("The Loft")).id, organizerId: userId, startsAt: minutesFromNow(-90), endsAt: minutesFromNow(-30), checkedInAt: minutesFromNow(-85),
    });
    const manager = await call(expireNoShows, "/x", { method: "POST", cookie: user });
    expect(manager.status).toBe(403);
    const first = await call(expireNoShows, "/x", { method: "POST", cookie: admin });
    expect(first.body).toEqual({ marked_no_show: 1, marked_completed: 1, reminders_sent: 1 });
    expect((await db.booking.findUniqueOrThrow({ where: { id: missed.id } })).status).toBe("NO_SHOW");
    expect((await db.booking.findUniqueOrThrow({ where: { id: finished.id } })).status).toBe("COMPLETED");
    expect((await db.booking.findUniqueOrThrow({ where: { id: reminder.id } })).status).toBe("CONFIRMED");
    const titles = (await db.notification.findMany({ where: { userId }, orderBy: { id: "asc" } })).map((item) => item.title).sort();
    expect(titles).toEqual(["Booking marked as no-show", "Check-in is open"]);
    const second = await call(expireNoShows, "/x", { method: "POST", cookie: admin });
    expect(second.body).toEqual({ marked_no_show: 0, marked_completed: 0, reminders_sent: 0 });
  });

  it("does not double-send when sweeps overlap", async () => {
    await insertBooking({ roomId: studioId, organizerId: userId, startsAt: minutesFromNow(10), endsAt: minutesFromNow(70) });
    await insertBooking({ roomId: (await roomByName("Focus Room")).id, organizerId: userId, startsAt: minutesFromNow(-30), endsAt: minutesFromNow(30) });
    await Promise.all([1, 2, 3].map(() => call(expireNoShows, "/x", { method: "POST", cookie: admin })));
    expect(await db.notification.count({ where: { title: "Check-in is open" } })).toBe(1);
    expect(await db.notification.count({ where: { title: "Booking marked as no-show" } })).toBe(1);
  });

  it("claims a throttled job for one caller per interval", async () => {
    const results = await Promise.all([1, 2, 3, 4].map(() => claimJob("test-job", 60)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await claimJob("test-job", 60)).toBe(false);
    await db.$executeRaw`UPDATE job_state SET last_run_at = now() - interval '2 minutes' WHERE name = 'test-job'`;
    expect(await claimJob("test-job", 60)).toBe(true);
  });
});

describe("cron endpoints", () => {
  const cron = (handler: unknown, authorization?: string) =>
    call(handler, "/api/cron/x", { headers: authorization ? { authorization } : {} });

  it("refuse requests without the shared secret", async () => {
    expect((await cron(sweepCron)).status).toBe(401);
    expect((await cron(sweepCron, "Bearer wrong")).status).toBe(401);
    expect((await cron(demoResetCron, "Bearer test-cron-secret-but-longer")).status).toBe(401);
    expect((await cron(sweepCron, "Bearer test-cron-secret")).status).toBe(200);
  });

  it("fail closed when no secret is configured", async () => {
    const secret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "";
    resetConfigForTests();
    try {
      expect((await cron(sweepCron, "Bearer ")).status).toBe(503);
    } finally {
      process.env.CRON_SECRET = secret;
      resetConfigForTests();
    }
  });

  it("reset demo data only in demo mode", async () => {
    await createUser("extra@meetinghub.com");
    const off = await cron(demoResetCron, "Bearer test-cron-secret");
    expect(off.body).toMatchObject({ reset: false });
    expect(await db.user.count()).toBe(3);

    process.env.DEMO_MODE = "true";
    resetConfigForTests();
    try {
      await insertBooking({ roomId: studioId, organizerId: userId, startsAt: new Date(slot(3, 10)), endsAt: new Date(slot(3, 11)) });
      const on = await cron(demoResetCron, "Bearer test-cron-secret");
      expect(on.body).toEqual({ reset: true });
    } finally {
      delete process.env.DEMO_MODE;
      resetConfigForTests();
    }
    expect(await db.user.count()).toBe(2);
    expect(await db.booking.count()).toBe(0);
    expect(await db.room.count()).toBe(6);
    expect(blob.del).toHaveBeenCalled();
    // The seed accounts work again after the wipe.
    expect(await signIn(login, "admin@meetinghub.com", "Admin123!")).toContain("meetinghub_session=");
  });

  it("resets through the service as well", async () => {
    await createUser("extra@meetinghub.com");
    await resetDemo();
    expect(await db.user.count()).toBe(2);
  });
});

describe("health", () => {
  it("answers liveness and readiness", async () => {
    expect((await call(health, "/health")).body).toEqual({ status: "ok" });
    expect((await call(ready, "/ready")).body).toEqual({ status: "ready" });
  });
});

describe("time helpers", () => {
  it("work in the facility timezone", () => {
    const instant = new Date("2026-10-15T20:30:00Z");
    expect(localIso(instant)).toBe("2026-10-16T03:30+07:00");
    expect(startOfLocalDay(instant).toISOString()).toBe("2026-10-15T17:00:00.000Z");
    expect(localIso(null)).toBe("");
  });
});
