import { beforeEach, describe, expect, it } from "vitest";

import { ADMIN, USER, type TestApp, createApp, insertBooking, minutesFromNow, roomId, slot, userId } from "../support/local";

let app: TestApp;
let studio: number;
let organizer: number;

beforeEach(async () => {
  app = createApp();
  studio = roomId(app, "Studio 01");
  organizer = userId(app, USER[0]);
  await app.signIn(...USER);
});

const book = (json: Record<string, unknown>) => app.call("POST", "/api/v1/bookings", { json });
const body = (overrides: Record<string, unknown> = {}) => ({
  room_id: studio,
  title: "Planning",
  attendee_count: 4,
  starts_at: slot(3, 10),
  ends_at: slot(3, 11),
  ...overrides,
});
const post = (path: string, json?: unknown) => app.call("POST", path, { json });
const iso = (value: string) => new Date(value).toISOString();
const addUser = (email: string) => {
  const db = app.data();
  const template = db.data.users.find((user) => user.email === USER[0])!;
  db.data.users.push({ ...template, id: db.nextId(db.data.users), email, full_name: email.split("@")[0] });
  app.commit(db);
};

describe("creating bookings", () => {
  it("creates a confirmed booking and lists it for the organizer and on the shared calendar", async () => {
    const created = await book(body({ description: "Quarterly" }));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ room_name: "Studio 01", organizer_name: "MeetingHub User", status: "CONFIRMED", series_id: null, description: "Quarterly" });
    expect((await app.call("GET", "/api/v1/bookings/my")).body).toHaveLength(1);
    const calendar = await app.call("GET", "/api/v1/bookings/schedule", { query: { starts_at: slot(3, 8), ends_at: slot(3, 18) } });
    expect(calendar.body[0]).toMatchObject({ title: "Planning", room_name: "Studio 01" });
    expect(calendar.body[0]).not.toHaveProperty("participant_emails");
  });

  it("requires sign-in and exposes the policy", async () => {
    expect((await app.call("GET", "/api/v1/booking-policy")).body).toMatchObject({ max_duration_hours: 4, max_advance_days: 30, timezone: "Asia/Bangkok" });
    app.signOut();
    expect((await book(body())).status).toBe(401);
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
    expect(app.data().data.bookings).toHaveLength(0);
  });

  it("includes the boundaries of the opening hours", async () => {
    expect((await book(body({ starts_at: slot(3, 8), ends_at: slot(3, 9) }))).status).toBe(201);
    expect((await book(body({ starts_at: slot(3, 17), ends_at: slot(3, 18) }))).status).toBe(201);
  });

  it("refuses overlapping bookings and bookings during maintenance, allowing back-to-back", async () => {
    expect((await book(body())).status).toBe(201);
    const clash = await book(body({ starts_at: slot(3, 10, 30), ends_at: slot(3, 11, 30) }));
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe("ROOM_UNAVAILABLE");
    expect((await book(body({ starts_at: slot(3, 11), ends_at: slot(3, 12) }))).status).toBe(201);
    await app.signIn(...ADMIN);
    await app.call("POST", "/api/v1/maintenance", { json: { room_id: studio, starts_at: slot(3, 14), ends_at: slot(3, 16), reason: "Paint" } });
    expect((await book(body({ starts_at: slot(3, 15), ends_at: slot(3, 16) }))).body.error.code).toBe("ROOM_UNAVAILABLE");
  });

  it("lets only one of several simultaneous requests win", async () => {
    const results = await Promise.all([book(body()), book(body()), book(body()), book(body())]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409, 409, 409]);
    expect(app.data().data.bookings).toHaveLength(1);
  });

  it("does not let a cancelled booking hold the room", async () => {
    const first = await book(body());
    await post(`/api/v1/bookings/${first.body.id}/cancel`);
    expect((await book(body())).status).toBe(201);
  });

  it("creates weekly series up to the advance limit and cancels them together", async () => {
    const created = await book(body({ recurrence_rule: "weekly", starts_at: slot(1, 10), ends_at: slot(1, 11) }));
    expect(created.status).toBe(201);
    expect(created.body.series_id).toMatch(/^[0-9a-f]{32}$/);
    const all = app.data().data.bookings.filter((item) => item.series_id === created.body.series_id);
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect(all.length).toBeLessThanOrEqual(5);
    expect(new Date(all[1].starts_at).getTime() - new Date(all[0].starts_at).getTime()).toBe(7 * 86_400_000);
    expect((await post(`/api/v1/bookings/${all[1].id}/cancel`)).body.status).toBe("CANCELLED");
    expect((await post(`/api/v1/bookings/${all[0].id}/cancel-series`)).body.cancelled).toBe(all.length - 1);
    expect(app.data().data.bookings.every((item) => item.status === "CANCELLED")).toBe(true);
  });

  it("refuses a series when any week is taken, creating nothing", async () => {
    insertBooking(app, { room_id: studio, organizer_id: organizer, starts_at: iso(slot(15, 10)), ends_at: iso(slot(15, 11)) });
    const response = await book(body({ recurrence_rule: "weekly", starts_at: slot(1, 10), ends_at: slot(1, 11) }));
    expect(response.status).toBe(409);
    expect(app.data().data.bookings).toHaveLength(1);
  });
});

describe("participants and notifications", () => {
  it("invites participants, lists invitations and notifies them", async () => {
    addUser("guest@meetinghub.com");
    const created = await book(body({ participant_emails: ["Guest@meetinghub.com", "guest@meetinghub.com"] }));
    expect(created.body.participant_emails).toEqual(["guest@meetinghub.com"]);
    app.signOut();
    const db = app.data();
    db.data.users.find((user) => user.email === "guest@meetinghub.com")!.password_hash = db.data.users.find((user) => user.email === USER[0])!.password_hash;
    app.commit(db);
    await app.signIn("guest@meetinghub.com", USER[1]);
    expect((await app.call("GET", "/api/v1/bookings/invited")).body).toHaveLength(1);
    const inbox = await app.call("GET", "/api/v1/notifications");
    expect(inbox.body.unread_count).toBe(1);
    expect(inbox.body.items[0]).toMatchObject({ title: "You were invited to a meeting", link: "/bookings", is_read: false });
    expect(inbox.body.items[0].message).toMatch(/Planning.*Studio 01 on \w{3} \d{2} \w{3}, 10:00/);
    expect((await post(`/api/v1/notifications/${inbox.body.items[0].id}/read`)).body.is_read).toBe(true);
    await post("/api/v1/notifications/read-all");
    expect((await app.call("GET", "/api/v1/notifications")).body.unread_count).toBe(0);
    await app.signIn(...USER);
    expect((await app.call("GET", "/api/v1/bookings/invited")).body).toHaveLength(0);
    // Someone else's notification is reported as missing.
    expect((await post(`/api/v1/notifications/${inbox.body.items[0].id}/read`)).status).toBe(404);
  });

  it("tells participants when a booking is moved or cancelled", async () => {
    addUser("guest@meetinghub.com");
    const created = await book(body({ participant_emails: ["guest@meetinghub.com"] }));
    await app.call("PATCH", `/api/v1/bookings/${created.body.id}`, { json: { starts_at: slot(3, 13), ends_at: slot(3, 14) } });
    await post(`/api/v1/bookings/${created.body.id}/cancel`);
    const guest = userId(app, "guest@meetinghub.com");
    const titles = app.data().data.notifications.filter((item) => item.user_id === guest).map((item) => item.title);
    expect(titles).toEqual(["You were invited to a meeting", "A meeting was moved", "A meeting was cancelled"]);
  });
});

describe("editing and cancelling", () => {
  it("lets only the organizer or a manager change a booking", async () => {
    const created = await book(body());
    const patch = (json: unknown) => app.call("PATCH", `/api/v1/bookings/${created.body.id}`, { json });
    addUser("other@meetinghub.com");
    const db = app.data();
    db.data.users.find((user) => user.email === "other@meetinghub.com")!.password_hash = db.data.users.find((user) => user.email === USER[0])!.password_hash;
    app.commit(db);
    await app.signIn("other@meetinghub.com", USER[1]);
    expect((await patch({ title: "Hijack" })).status).toBe(403);
    expect((await post(`/api/v1/bookings/${created.body.id}/cancel`)).status).toBe(403);
    await app.signIn(...ADMIN);
    expect((await patch({ title: "Renamed", description: "" })).body).toMatchObject({ title: "Renamed", description: null });
    await app.signIn(...USER);
    expect((await patch({ title: null })).status).toBe(422);
    expect((await patch({ attendee_count: 50 })).body.error.code).toBe("CAPACITY_EXCEEDED");
    expect((await patch({ starts_at: slot(3, 8), ends_at: slot(3, 13) })).status).toBe(422);
    expect((await app.call("PATCH", "/api/v1/bookings/9999", { json: { title: "Nope" } })).status).toBe(404);
  });

  it("checks conflicts when moving, excluding the booking itself", async () => {
    const first = await book(body());
    await book(body({ starts_at: slot(3, 12), ends_at: slot(3, 13) }));
    const patch = (json: unknown) => app.call("PATCH", `/api/v1/bookings/${first.body.id}`, { json });
    expect((await patch({ ends_at: slot(3, 12, 30) })).body.error.code).toBe("ROOM_UNAVAILABLE");
    expect((await patch({ ends_at: slot(3, 11, 30) })).status).toBe(200);
  });

  it("replaces participants on update", async () => {
    addUser("a@meetinghub.com");
    addUser("b@meetinghub.com");
    const created = await book(body({ participant_emails: ["a@meetinghub.com"] }));
    const updated = await app.call("PATCH", `/api/v1/bookings/${created.body.id}`, { json: { participant_emails: ["b@meetinghub.com"] } });
    expect(updated.body.participant_emails).toEqual(["b@meetinghub.com"]);
  });

  it("cancels once, and refuses to cancel finished bookings", async () => {
    const created = await book(body());
    expect((await post(`/api/v1/bookings/${created.body.id}/cancel`)).body.status).toBe("CANCELLED");
    expect((await post(`/api/v1/bookings/${created.body.id}/cancel`)).status).toBe(200);
    const done = insertBooking(app, { room_id: studio, organizer_id: organizer, status: "COMPLETED", starts_at: iso(slot(-2, 10)), ends_at: iso(slot(-2, 11)) });
    expect((await post(`/api/v1/bookings/${done.id}/cancel`)).body.error.code).toBe("BOOKING_NOT_CANCELLABLE");
    expect((await post(`/api/v1/bookings/${created.body.id}/cancel-series`)).body.error.code).toBe("NOT_A_SERIES");
  });
});

describe("approval workflow", () => {
  beforeEach(() => {
    const db = app.data();
    db.room(studio)!.requires_approval = true;
    app.commit(db);
  });

  it("holds the slot until a manager approves, and tells the managers", async () => {
    const created = await book(body());
    expect(created.body.status).toBe("PENDING_APPROVAL");
    expect((await book(body())).status).toBe(409);
    expect((await app.call("GET", "/api/v1/bookings/pending")).status).toBe(403);
    expect((await post(`/api/v1/bookings/${created.body.id}/approve`)).status).toBe(403);
    await app.signIn(...ADMIN);
    expect((await app.call("GET", "/api/v1/bookings/pending")).body).toHaveLength(1);
    // Both managers of the demo data (the administrator and the facility manager) are told, the requester is not.
    const told = app.data().data.notifications.filter((item) => item.title === "Booking awaiting approval").map((item) => item.user_id).sort();
    expect(told).toEqual([userId(app, ADMIN[0]), userId(app, "facility@meetinghub.com")].sort());
    expect((await post(`/api/v1/bookings/${created.body.id}/approve`)).body.status).toBe("CONFIRMED");
    expect((await post(`/api/v1/bookings/${created.body.id}/approve`)).body.error.code).toBe("BOOKING_NOT_PENDING");
    await app.signIn(...USER);
    expect((await app.call("GET", "/api/v1/notifications")).body.items[0].title).toBe("Booking approved");
  });

  it("requires a reason to reject and frees the room afterwards", async () => {
    const created = await book(body());
    await app.signIn(...ADMIN);
    expect((await post(`/api/v1/bookings/${created.body.id}/reject`, { reason: " " })).status).toBe(422);
    const rejected = await post(`/api/v1/bookings/${created.body.id}/reject`, { reason: "  Needs the room  " });
    expect(rejected.body).toMatchObject({ status: "REJECTED", decision_note: "Needs the room" });
    expect((await book(body())).status).toBe(201);
    await app.signIn(...USER);
    expect((await app.call("GET", "/api/v1/notifications")).body.items.map((item: { message: string }) => item.message).join(" ")).toContain("Reason: Needs the room");
  });

  it("sends a moved booking back for approval", async () => {
    const db = app.data();
    db.room(studio)!.requires_approval = false;
    app.commit(db);
    const created = await book(body());
    const again = app.data();
    again.room(studio)!.requires_approval = true;
    app.commit(again);
    const moved = await app.call("PATCH", `/api/v1/bookings/${created.body.id}`, { json: { starts_at: slot(3, 13), ends_at: slot(3, 14) } });
    expect(moved.body.status).toBe("PENDING_APPROVAL");
  });
});

describe("check-in", () => {
  const checkIn = (id: number) => post(`/api/v1/bookings/${id}/check-in`);

  it("opens 15 minutes before the start and only for confirmed bookings", async () => {
    const early = insertBooking(app, { room_id: roomId(app, "Boardroom A"), organizer_id: organizer, starts_at: minutesFromNow(40).toISOString(), ends_at: minutesFromNow(100).toISOString() });
    expect((await checkIn(early.id)).body.error.code).toBe("CHECK_IN_NOT_OPEN");
    const due = insertBooking(app, { room_id: studio, organizer_id: organizer, starts_at: minutesFromNow(5).toISOString(), ends_at: minutesFromNow(65).toISOString() });
    expect((await checkIn(due.id)).body).toMatchObject({ message: "Check-in successful", booking_id: due.id });
    expect((await checkIn(due.id)).body.message).toBe("Already checked in");
    expect(app.data().data.check_ins.filter((item) => item.booking_id === due.id)).toHaveLength(1);
    const late = insertBooking(app, { room_id: roomId(app, "Focus Room"), organizer_id: organizer, starts_at: minutesFromNow(-20).toISOString(), ends_at: minutesFromNow(40).toISOString() });
    // There is no scheduler, so every request first catches up: a booking past its grace period is already a no-show.
    expect((await checkIn(late.id)).body.error.code).toBe("BOOKING_NOT_CONFIRMED");
    expect(app.data().booking(late.id)!.status).toBe("NO_SHOW");
    const pendingBooking = insertBooking(app, { room_id: roomId(app, "The Loft"), organizer_id: organizer, status: "PENDING_APPROVAL", starts_at: minutesFromNow(5).toISOString(), ends_at: minutesFromNow(65).toISOString() });
    expect((await checkIn(pendingBooking.id)).body.error.code).toBe("BOOKING_NOT_CONFIRMED");
  });

  it("checks in by scanning the code for the room", async () => {
    const due = insertBooking(app, { room_id: studio, organizer_id: organizer, starts_at: minutesFromNow(5).toISOString(), ends_at: minutesFromNow(65).toISOString() });
    await app.signIn(...ADMIN);
    const { token } = (await app.call("GET", `/api/v1/rooms/${studio}/check-in-token`)).body;
    await app.signIn(...USER);
    const scan = () => post(`/api/v1/rooms/${studio}/check-in`, { token });
    expect((await scan()).body).toMatchObject({ message: "Check-in successful", booking_id: due.id });
    expect((await scan()).body.message).toBe("Already checked in");
    expect(app.data().data.check_ins.find((item) => item.booking_id === due.id)!.method).toBe("QR");
  });
});
