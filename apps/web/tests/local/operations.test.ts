import { beforeEach, describe, expect, it } from "vitest";

import { csvCell } from "../../lib/local/handlers/operations";
import { localIso, startOfLocalDay } from "../../lib/local/time";
import { ADMIN, USER, type TestApp, createApp, insertBooking, minutesFromNow, roomId, slot, userId } from "../support/local";

let app: TestApp;
let studio: number;
let organizer: number;

beforeEach(async () => {
  app = createApp();
  studio = roomId(app, "Studio 01");
  organizer = userId(app, USER[0]);
  await app.signIn(...ADMIN);
});

const iso = (value: string) => new Date(value).toISOString();

describe("maintenance", () => {
  it("is managed by managers, validated, and audited", async () => {
    const payload = { room_id: studio, starts_at: slot(2, 9), ends_at: slot(2, 12), reason: "Repaint" };
    await app.signIn(...USER);
    expect((await app.call("POST", "/api/v1/maintenance", { json: payload })).status).toBe(403);
    await app.signIn(...ADMIN);
    const created = await app.call("POST", "/api/v1/maintenance", { json: payload });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ room_name: "Studio 01", reason: "Repaint" });
    expect((await app.call("POST", "/api/v1/maintenance", { json: { ...payload, room_id: 999 } })).status).toBe(404);
    expect((await app.call("POST", "/api/v1/maintenance", { json: { ...payload, ends_at: slot(2, 8) } })).body.error.field).toBe("ends_at");
    expect((await app.call("GET", "/api/v1/maintenance")).body).toHaveLength(1);
    expect((await app.call("DELETE", `/api/v1/maintenance/${created.body.id}`)).status).toBe(200);
    expect((await app.call("DELETE", `/api/v1/maintenance/${created.body.id}`)).status).toBe(404);
    expect(app.data().data.audit_logs.filter((log) => log.entity === "Maintenance").map((log) => log.action)).toEqual(["CREATE", "DELETE"]);
  });
});

describe("dashboard and reports", () => {
  beforeEach(() => {
    const day = startOfLocalDay(new Date()).getTime();
    const at = (hour: number) => new Date(day + hour * 3_600_000).toISOString();
    const rooms = [studio, roomId(app, "Focus Room"), roomId(app, "The Loft")];
    // Checked in, so the catch-up before each request leaves it alone whatever the time of day is.
    insertBooking(app, { room_id: rooms[0], organizer_id: organizer, status: "COMPLETED", checked_in_at: at(9), starts_at: at(9), ends_at: at(10) });
    insertBooking(app, { room_id: rooms[0], organizer_id: organizer, status: "CANCELLED", starts_at: at(9), ends_at: at(10) });
    insertBooking(app, { room_id: rooms[1], organizer_id: organizer, status: "NO_SHOW", starts_at: at(9), ends_at: at(10) });
    insertBooking(app, { room_id: rooms[2], organizer_id: organizer, status: "REJECTED", starts_at: at(9), ends_at: at(10) });
  });

  it("counts today and totals for managers only", async () => {
    await app.signIn(...USER);
    expect((await app.call("GET", "/api/v1/dashboard")).status).toBe(403);
    await app.signIn(...ADMIN);
    expect((await app.call("GET", "/api/v1/dashboard")).body).toEqual({ bookings_today: 4, active_rooms: 6, cancelled_bookings: 1, no_shows: 1 });
  });

  it("summarises usage, ignoring requests that never held the room", async () => {
    const response = await app.call("GET", "/api/v1/reports/summary");
    expect(response.body).toMatchObject({ total_bookings: 4, cancelled_bookings: 1, rejected_bookings: 1, no_show_bookings: 1, cancellation_rate: 25, no_show_rate: 25 });
    // A no-show still used the room; equal counts are ordered by name.
    expect(response.body.most_used_rooms.slice(0, 2)).toEqual([
      { room: "Focus Room", bookings: 1 },
      { room: "Studio 01", bookings: 1 },
    ]);
    expect(response.body.most_used_rooms).toHaveLength(5);
    expect((await app.call("GET", "/api/v1/reports/summary", { query: { starts_at: slot(10, 0), ends_at: slot(11, 0) } })).body).toMatchObject({ total_bookings: 0, cancellation_rate: 0 });
    expect((await app.call("GET", "/api/v1/reports/summary", { query: { starts_at: slot(11, 0), ends_at: slot(10, 0) } })).body.error.code).toBe("INVALID_TIME_RANGE");
  });

  it("exports CSV with a byte-order mark and without spreadsheet formulas", async () => {
    insertBooking(app, {
      room_id: studio,
      organizer_id: organizer,
      title: '=HYPERLINK("http://evil"),"quoted"',
      decision_note: "ประชุมทีม",
      starts_at: iso(slot(5, 10)),
      ends_at: iso(slot(5, 11)),
    });
    await app.signIn(...USER);
    expect((await app.call("GET", "/api/v1/reports/bookings.csv")).status).toBe(403);
    await app.signIn(...ADMIN);
    const response = await app.call("GET", "/api/v1/reports/bookings.csv");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("bookings.csv");
    const text = response.body as string;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain("id,room,building,title,organizer");
    expect(text).toContain("\"'=HYPERLINK(\"\"http://evil\"\"),\"\"quoted\"\"\"");
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
    await app.call("POST", "/api/v1/maintenance", { json: { room_id: studio, starts_at: slot(2, 9), ends_at: slot(2, 12), reason: "Repaint" } });
    await app.signIn(...USER);
    expect((await app.call("GET", "/api/v1/audit-logs")).status).toBe(403);
    await app.signIn(...ADMIN);
    const all = await app.call("GET", "/api/v1/audit-logs");
    expect(all.body[0]).toMatchObject({ actor_email: ADMIN[0], action: "CREATE", entity: "Maintenance" });
    expect((await app.call("GET", "/api/v1/audit-logs", { query: { entity: "Room" } })).body).toHaveLength(0);
    expect((await app.call("GET", "/api/v1/audit-logs", { query: { limit: 500 } })).status).toBe(422);
  });
});

describe("catching up without a scheduler", () => {
  it("reminds, marks no-shows and completes finished check-ins, exactly once", async () => {
    const reminder = insertBooking(app, { room_id: studio, organizer_id: organizer, starts_at: minutesFromNow(10).toISOString(), ends_at: minutesFromNow(70).toISOString() });
    const missed = insertBooking(app, { room_id: roomId(app, "Focus Room"), organizer_id: organizer, starts_at: minutesFromNow(-30).toISOString(), ends_at: minutesFromNow(30).toISOString() });
    const finished = insertBooking(app, {
      room_id: roomId(app, "The Loft"),
      organizer_id: organizer,
      starts_at: minutesFromNow(-90).toISOString(),
      ends_at: minutesFromNow(-30).toISOString(),
      checked_in_at: minutesFromNow(-85).toISOString(),
    });
    await app.signIn(...USER);
    expect((await app.call("POST", "/api/v1/jobs/expire-no-shows")).status).toBe(403);
    // The sign-in request above already caught up, so the on-demand run finds nothing new.
    await app.signIn(...ADMIN);
    expect((await app.call("POST", "/api/v1/jobs/expire-no-shows")).body).toEqual({ marked_no_show: 0, marked_completed: 0, reminders_sent: 0 });
    const db = app.data();
    expect(db.booking(missed.id)!.status).toBe("NO_SHOW");
    expect(db.booking(finished.id)!.status).toBe("COMPLETED");
    expect(db.booking(reminder.id)!.status).toBe("CONFIRMED");
    const titles = db.data.notifications.filter((item) => item.user_id === organizer).map((item) => item.title).sort();
    expect(titles).toEqual(["Booking marked as no-show", "Check-in is open"]);
  });

  it("does not send a reminder twice", async () => {
    insertBooking(app, { room_id: studio, organizer_id: organizer, starts_at: minutesFromNow(10).toISOString(), ends_at: minutesFromNow(70).toISOString() });
    for (let call = 0; call < 3; call += 1) await app.call("GET", "/api/v1/auth/me");
    expect(app.data().data.notifications.filter((item) => item.title === "Check-in is open")).toHaveLength(1);
  });

  it("follows a clock that moves forward", async () => {
    const created = await app.call("POST", "/api/v1/bookings", {
      json: { room_id: studio, title: "Later", attendee_count: 2, starts_at: slot(2, 10), ends_at: slot(2, 11) },
    });
    app.setNow(new Date(new Date(slot(2, 10)).getTime() + 20 * 60_000));
    await app.call("GET", "/api/v1/auth/me");
    expect(app.data().booking(created.body.id)!.status).toBe("NO_SHOW");
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
