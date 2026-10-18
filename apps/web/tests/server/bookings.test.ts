import { beforeEach, describe, expect, it } from "vitest";

import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as approve } from "@/app/api/v1/bookings/[bookingId]/approve/route";
import { POST as cancel } from "@/app/api/v1/bookings/[bookingId]/cancel/route";
import { POST as cancelSeries } from "@/app/api/v1/bookings/[bookingId]/cancel-series/route";
import { POST as checkIn } from "@/app/api/v1/bookings/[bookingId]/check-in/route";
import { POST as reject } from "@/app/api/v1/bookings/[bookingId]/reject/route";
import { PATCH as update } from "@/app/api/v1/bookings/[bookingId]/route";
import { GET as invited } from "@/app/api/v1/bookings/invited/route";
import { GET as myBookings } from "@/app/api/v1/bookings/my/route";
import { GET as pending } from "@/app/api/v1/bookings/pending/route";
import { POST as createBooking } from "@/app/api/v1/bookings/route";
import { GET as schedule } from "@/app/api/v1/bookings/schedule/route";
import { GET as policy } from "@/app/api/v1/booking-policy/route";
import { GET as notifications } from "@/app/api/v1/notifications/route";
import { POST as markRead } from "@/app/api/v1/notifications/[notificationId]/read/route";
import { POST as markAllRead } from "@/app/api/v1/notifications/read-all/route";
import { POST as checkInAtRoom } from "@/app/api/v1/rooms/[roomId]/check-in/route";
import { db } from "@/lib/server/db";
import { createCheckInToken } from "@/lib/server/security";

import { call, createUser, insertBooking, resetDatabase, roomByName, signIn, slot } from "../support/app";

let admin: string;
let user: string;
let studioId: number;
let userId: number;

const book = (json: Record<string, unknown>, cookie = user) =>
  call(createBooking, "/api/v1/bookings", { method: "POST", cookie, json });
const body = (overrides: Record<string, unknown> = {}) => ({
  room_id: studioId,
  title: "Planning",
  attendee_count: 4,
  starts_at: slot(3, 10),
  ends_at: slot(3, 11),
  ...overrides,
});
const withId = (handler: unknown, id: number, cookie: string, extra: Record<string, unknown> = {}) =>
  call(handler, "/x", { method: "POST", cookie, params: { bookingId: id }, ...extra });

beforeEach(async () => {
  await resetDatabase();
  admin = await signIn(login, "admin@meetinghub.com", "Admin123!");
  user = await signIn(login, "user@meetinghub.com", "User123!");
  studioId = (await roomByName("Studio 01")).id;
  userId = (await db.user.findUniqueOrThrow({ where: { email: "user@meetinghub.com" } })).id;
});

describe("creating bookings", () => {
  it("creates a confirmed booking and lists it", async () => {
    const created = await book(body({ description: "Quarterly" }));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      room_name: "Studio 01", organizer_name: "MeetingHub User", status: "CONFIRMED", series_id: null, description: "Quarterly",
    });
    const mine = await call(myBookings, "/api/v1/bookings/my", { cookie: user });
    expect(mine.body).toHaveLength(1);
    const calendar = await call(schedule, "/api/v1/bookings/schedule", {
      cookie: admin, query: { starts_at: slot(3, 8), ends_at: slot(3, 18) },
    });
    expect(calendar.body[0]).toMatchObject({ title: "Planning", room_name: "Studio 01" });
    expect(calendar.body[0]).not.toHaveProperty("participant_emails");
  });

  it("requires sign-in and exposes the policy", async () => {
    expect((await call(createBooking, "/x", { method: "POST", json: body() })).status).toBe(401);
    const response = await call(policy, "/x", { cookie: user });
    expect(response.body).toMatchObject({ max_duration_hours: 4, max_advance_days: 30, timezone: "Asia/Bangkok" });
  });

  it("enforces the booking rules", async () => {
    const code = async (overrides: Record<string, unknown>) => (await book(body(overrides))).body.error?.code;
    expect(await code({ starts_at: slot(-1, 10), ends_at: slot(-1, 11) })).toBe("BOOKING_IN_PAST");
    expect(await code({ starts_at: slot(45, 10), ends_at: slot(45, 11) })).toBe("BOOKING_TOO_FAR_AHEAD");
    expect(await code({ starts_at: slot(3, 7), ends_at: slot(3, 8) })).toBe("OUTSIDE_OPENING_HOURS");
    expect(await code({ starts_at: slot(3, 17), ends_at: slot(3, 19) })).toBe("OUTSIDE_OPENING_HOURS");
    expect(await code({ attendee_count: 99 })).toBe("CAPACITY_EXCEEDED");
    expect(await code({ room_id: 9999 })).toBe("ROOM_NOT_AVAILABLE");
    expect(await code({ participant_emails: ["nobody@meetinghub.com"] })).toBe("UNKNOWN_PARTICIPANT");
    expect((await book(body({ starts_at: slot(3, 8), ends_at: slot(3, 13) }))).body.error.message).toBe("A booking cannot exceed 4 hours");
    expect((await book(body({ ends_at: slot(3, 9) }))).body.error.field).toBe("ends_at");
    expect((await book(body({ starts_at: "2026-10-20T10:00:00" }))).status).toBe(422);
    expect((await book(body({ title: "x" }))).body.error.field).toBe("title");
    expect(await db.booking.count()).toBe(0);
  });

  it("includes the boundaries of the opening hours", async () => {
    expect((await book(body({ starts_at: slot(3, 8), ends_at: slot(3, 9) }))).status).toBe(201);
    expect((await book(body({ starts_at: slot(3, 17), ends_at: slot(3, 18) }))).status).toBe(201);
  });

  it("refuses overlapping bookings and bookings during maintenance, allowing back-to-back", async () => {
    expect((await book(body())).status).toBe(201);
    const clash = await book(body({ starts_at: slot(3, 10, 30), ends_at: slot(3, 11, 30) }), admin);
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe("ROOM_UNAVAILABLE");
    expect((await book(body({ starts_at: slot(3, 11), ends_at: slot(3, 12) }))).status).toBe(201);
    await db.maintenance.create({
      data: { roomId: studioId, startsAt: new Date(slot(3, 14)), endsAt: new Date(slot(3, 16)), reason: "Paint" },
    });
    expect((await book(body({ starts_at: slot(3, 15), ends_at: slot(3, 16) }))).body.error.code).toBe("ROOM_UNAVAILABLE");
  });

  it("lets the database constraint decide a race between two requests", async () => {
    const results = await Promise.all([book(body()), book(body(), admin), book(body(), admin), book(body())]);
    const statuses = results.map((result) => result.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409]);
    expect(results.filter((result) => result.status === 409).every((result) => result.body.error.code === "ROOM_UNAVAILABLE")).toBe(true);
    expect(await db.booking.count()).toBe(1);
  });

  it("rejects a double booking made straight in the database", async () => {
    await insertBooking({ roomId: studioId, organizerId: userId, startsAt: new Date(slot(3, 10)), endsAt: new Date(slot(3, 11)) });
    await expect(
      insertBooking({ roomId: studioId, organizerId: userId, startsAt: new Date(slot(3, 10, 30)), endsAt: new Date(slot(3, 12)) }),
    ).rejects.toThrow(/bookings_no_overlap|exclusion/);
    // A cancelled booking does not hold the room.
    await insertBooking({ roomId: studioId, organizerId: userId, status: "CANCELLED", startsAt: new Date(slot(3, 10)), endsAt: new Date(slot(3, 11)) });
  });

  it("creates weekly series up to the advance limit and cancels them together", async () => {
    const created = await book(body({ recurrence_rule: "weekly", starts_at: slot(1, 10), ends_at: slot(1, 11) }));
    expect(created.status).toBe(201);
    expect(created.body.series_id).toMatch(/^[0-9a-f]{32}$/);
    const all = await db.booking.findMany({ where: { seriesId: created.body.series_id }, orderBy: { startsAt: "asc" } });
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect(all.length).toBeLessThanOrEqual(5);
    expect(all[1].startsAt.getTime() - all[0].startsAt.getTime()).toBe(7 * 86_400_000);

    const one = await withId(cancel, all[1].id, user);
    expect(one.body.status).toBe("CANCELLED");
    const rest = await withId(cancelSeries, all[0].id, user);
    expect(rest.body.cancelled).toBe(all.length - 1);
    expect(await db.booking.count({ where: { seriesId: created.body.series_id, status: "CANCELLED" } })).toBe(all.length);
  });

  it("refuses a series when any week is taken", async () => {
    await insertBooking({ roomId: studioId, organizerId: userId, startsAt: new Date(slot(15, 10)), endsAt: new Date(slot(15, 11)) });
    const response = await book(body({ recurrence_rule: "weekly", starts_at: slot(1, 10), ends_at: slot(1, 11) }));
    expect(response.status).toBe(409);
    expect(await db.booking.count()).toBe(1);
  });
});

describe("participants and notifications", () => {
  it("invites participants, lists invitations and notifies them", async () => {
    const guest = await createUser("guest@meetinghub.com");
    const created = await book(body({ participant_emails: ["Guest@meetinghub.com", "guest@meetinghub.com"] }));
    expect(created.body.participant_emails).toEqual(["guest@meetinghub.com"]);
    const guestCookie = await signIn(login, "guest@meetinghub.com", "Passw0rd!x");
    const invitations = await call(invited, "/x", { cookie: guestCookie });
    expect(invitations.body).toHaveLength(1);
    expect((await call(invited, "/x", { cookie: user })).body).toHaveLength(0);

    const inbox = await call(notifications, "/api/v1/notifications", { cookie: guestCookie });
    expect(inbox.body.unread_count).toBe(1);
    expect(inbox.body.items[0]).toMatchObject({ title: "You were invited to a meeting", link: "/bookings", is_read: false });
    expect(inbox.body.items[0].message).toMatch(/Planning.*Studio 01 on \w{3} \d{2} \w{3}, 10:00/);

    const other = await call(markRead, "/x", { method: "POST", cookie: user, params: { notificationId: inbox.body.items[0].id } });
    expect(other.status).toBe(404);
    const read = await call(markRead, "/x", { method: "POST", cookie: guestCookie, params: { notificationId: inbox.body.items[0].id } });
    expect(read.body.is_read).toBe(true);
    await db.notification.create({ data: { userId: guest.id, title: "t", message: "m" } });
    await call(markAllRead, "/x", { method: "POST", cookie: guestCookie });
    expect((await call(notifications, "/x", { cookie: guestCookie })).body.unread_count).toBe(0);
  });

  it("tells participants when a booking is moved or cancelled", async () => {
    await createUser("guest@meetinghub.com");
    const created = await book(body({ participant_emails: ["guest@meetinghub.com"] }));
    const moved = await call(update, "/x", {
      method: "PATCH", cookie: user, params: { bookingId: created.body.id },
      json: { starts_at: slot(3, 13), ends_at: slot(3, 14) },
    });
    expect(moved.status).toBe(200);
    await withId(cancel, created.body.id, user);
    const titles = (await db.notification.findMany({ where: { user: { email: "guest@meetinghub.com" } }, orderBy: { id: "asc" } })).map((item) => item.title);
    expect(titles).toEqual(["You were invited to a meeting", "A meeting was moved", "A meeting was cancelled"]);
  });
});

describe("editing and cancelling", () => {
  it("lets only the organizer or a manager change a booking", async () => {
    const created = await book(body());
    const stranger = await createUser("other@meetinghub.com");
    const strangerCookie = await signIn(login, "other@meetinghub.com", "Passw0rd!x");
    expect(stranger.id).toBeGreaterThan(0);
    const patch = (cookie: string, json: unknown) =>
      call(update, "/x", { method: "PATCH", cookie, params: { bookingId: created.body.id }, json });
    expect((await patch(strangerCookie, { title: "Hijack" })).status).toBe(403);
    expect((await withId(cancel, created.body.id, strangerCookie)).status).toBe(403);
    expect((await patch(admin, { title: "Renamed", description: "" })).body).toMatchObject({ title: "Renamed", description: null });
    expect((await patch(user, { title: null })).status).toBe(422);
    expect((await patch(user, { attendee_count: 50 })).body.error.code).toBe("CAPACITY_EXCEEDED");
    expect((await patch(user, { starts_at: slot(3, 8), ends_at: slot(3, 13) })).status).toBe(422);
    expect((await call(update, "/x", { method: "PATCH", cookie: user, params: { bookingId: 9999 }, json: { title: "Nope" } })).status).toBe(404);
  });

  it("checks conflicts when moving, excluding the booking itself", async () => {
    const first = await book(body());
    await book(body({ starts_at: slot(3, 12), ends_at: slot(3, 13) }));
    const patch = (json: unknown) => call(update, "/x", { method: "PATCH", cookie: user, params: { bookingId: first.body.id }, json });
    expect((await patch({ ends_at: slot(3, 12, 30) })).body.error.code).toBe("ROOM_UNAVAILABLE");
    expect((await patch({ ends_at: slot(3, 11, 30) })).status).toBe(200);
  });

  it("replaces participants on update", async () => {
    await createUser("a@meetinghub.com");
    await createUser("b@meetinghub.com");
    const created = await book(body({ participant_emails: ["a@meetinghub.com"] }));
    const updated = await call(update, "/x", {
      method: "PATCH", cookie: user, params: { bookingId: created.body.id }, json: { participant_emails: ["b@meetinghub.com"] },
    });
    expect(updated.body.participant_emails).toEqual(["b@meetinghub.com"]);
  });

  it("cancels once, and refuses to cancel finished bookings", async () => {
    const created = await book(body());
    expect((await withId(cancel, created.body.id, user)).body.status).toBe("CANCELLED");
    expect((await withId(cancel, created.body.id, user)).status).toBe(200);
    const done = await insertBooking({ roomId: studioId, organizerId: userId, status: "COMPLETED", startsAt: new Date(slot(-2, 10)), endsAt: new Date(slot(-2, 11)) });
    expect((await withId(cancel, done.id, user)).body.error.code).toBe("BOOKING_NOT_CANCELLABLE");
    expect((await withId(cancelSeries, created.body.id, user)).body.error.code).toBe("NOT_A_SERIES");
  });
});

describe("approval workflow", () => {
  beforeEach(async () => {
    await db.room.update({ where: { id: studioId }, data: { requiresApproval: true } });
  });

  it("holds the slot until a manager approves, and tells the managers", async () => {
    const created = await book(body());
    expect(created.body.status).toBe("PENDING_APPROVAL");
    expect((await book(body(), admin)).status).toBe(409);
    expect((await call(pending, "/x", { cookie: user })).status).toBe(403);
    expect((await call(pending, "/x", { cookie: admin })).body).toHaveLength(1);
    expect(await db.notification.count({ where: { title: "Booking awaiting approval" } })).toBe(1);
    expect((await withId(approve, created.body.id, user)).status).toBe(403);
    const approved = await withId(approve, created.body.id, admin);
    expect(approved.body.status).toBe("CONFIRMED");
    expect((await withId(approve, created.body.id, admin)).body.error.code).toBe("BOOKING_NOT_PENDING");
    const inbox = await call(notifications, "/x", { cookie: user });
    expect(inbox.body.items[0].title).toBe("Booking approved");
  });

  it("requires a reason to reject and frees the room afterwards", async () => {
    const created = await book(body());
    const noReason = await withId(reject, created.body.id, admin, { json: { reason: " " } });
    expect(noReason.status).toBe(422);
    const rejected = await withId(reject, created.body.id, admin, { json: { reason: "  Needs the room  " } });
    expect(rejected.body).toMatchObject({ status: "REJECTED", decision_note: "Needs the room" });
    expect((await book(body(), admin)).status).toBe(201);
    const inbox = await call(notifications, "/x", { cookie: user });
    expect(inbox.body.items[0].message).toContain("Reason: Needs the room");
  });

  it("sends a moved booking back for approval", async () => {
    await db.room.update({ where: { id: studioId }, data: { requiresApproval: false } });
    const created = await book(body());
    await db.room.update({ where: { id: studioId }, data: { requiresApproval: true } });
    const moved = await call(update, "/x", {
      method: "PATCH", cookie: user, params: { bookingId: created.body.id }, json: { starts_at: slot(3, 13), ends_at: slot(3, 14) },
    });
    expect(moved.body.status).toBe("PENDING_APPROVAL");
  });
});

describe("check-in", () => {
  const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000);

  it("opens 15 minutes before the start and only for confirmed bookings", async () => {
    const early = await insertBooking({ roomId: (await roomByName("Boardroom A")).id, organizerId: userId, startsAt: minutesFromNow(40), endsAt: minutesFromNow(100) });
    expect((await withId(checkIn, early.id, user)).body.error.code).toBe("CHECK_IN_NOT_OPEN");
    const due = await insertBooking({ roomId: studioId, organizerId: userId, startsAt: minutesFromNow(5), endsAt: minutesFromNow(65) });
    const first = await withId(checkIn, due.id, user);
    expect(first.body).toMatchObject({ message: "Check-in successful", booking_id: due.id });
    expect((await withId(checkIn, due.id, user)).body.message).toBe("Already checked in");
    expect(await db.checkIn.count({ where: { bookingId: due.id } })).toBe(1);
    const stranger = await signIn(login, "admin@meetinghub.com", "Admin123!");
    expect((await withId(checkIn, due.id, stranger)).status).toBe(200);
    const late = await insertBooking({ roomId: (await roomByName("Focus Room")).id, organizerId: userId, startsAt: minutesFromNow(-20), endsAt: minutesFromNow(40) });
    expect((await withId(checkIn, late.id, user)).body.error.code).toBe("CHECK_IN_CLOSED");
    const pendingBooking = await insertBooking({ roomId: (await roomByName("The Loft")).id, organizerId: userId, status: "PENDING_APPROVAL", startsAt: minutesFromNow(5), endsAt: minutesFromNow(65) });
    expect((await withId(checkIn, pendingBooking.id, user)).body.error.code).toBe("BOOKING_NOT_CONFIRMED");
  });

  it("records two simultaneous check-ins once", async () => {
    const due = await insertBooking({ roomId: studioId, organizerId: userId, startsAt: minutesFromNow(5), endsAt: minutesFromNow(65) });
    const results = await Promise.all([withId(checkIn, due.id, user), withId(checkIn, due.id, user), withId(checkIn, due.id, user)]);
    expect(results.every((result) => result.status === 200)).toBe(true);
    expect(await db.checkIn.count({ where: { bookingId: due.id } })).toBe(1);
    expect(results.filter((result) => result.body.message === "Check-in successful")).toHaveLength(1);
  });

  it("checks in by scanning the code for the room", async () => {
    const due = await insertBooking({ roomId: studioId, organizerId: userId, startsAt: minutesFromNow(5), endsAt: minutesFromNow(65) });
    const token = await createCheckInToken(studioId);
    const scan = () => call(checkInAtRoom, "/x", { method: "POST", cookie: user, params: { roomId: studioId }, json: { token } });
    expect((await scan()).body).toMatchObject({ message: "Check-in successful", booking_id: due.id });
    expect((await scan()).body.message).toBe("Already checked in");
    expect((await db.checkIn.findFirstOrThrow({ where: { bookingId: due.id } })).method).toBe("QR");
    const expired = await createCheckInToken(studioId, -10);
    const response = await call(checkInAtRoom, "/x", { method: "POST", cookie: user, params: { roomId: studioId }, json: { token: expired } });
    expect(response.body.error.code).toBe("CHECK_IN_CODE_EXPIRED");
  });
});
