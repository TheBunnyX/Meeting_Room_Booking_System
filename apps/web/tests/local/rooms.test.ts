import { beforeEach, describe, expect, it } from "vitest";

import { ADMIN, USER, type TestApp, createApp, insertBooking, roomId, slot, userId } from "../support/local";

let app: TestApp;

beforeEach(async () => {
  app = createApp();
  // A facility administrator, created straight in the data like an extra entry in data/db.json would be.
  const db = app.data();
  const admin = db.data.users.find((user) => user.email === ADMIN[0])!;
  db.data.users.push({ ...admin, id: db.nextId(db.data.users), email: "fac@meetinghub.com", full_name: "Facility", role: "FACILITY_ADMIN" });
  app.commit(db);
  await app.signIn(...USER);
});

const asAdmin = () => app.signIn(...ADMIN);
const names = (rooms: { name: string }[]) => rooms.map((room) => room.name).sort();

describe("rooms", () => {
  it("lists active rooms with equipment and hides inactive ones from non-managers", async () => {
    const db = app.data();
    db.room(roomId(app, "Studio 01"))!.is_active = false;
    app.commit(db);
    const asUser = await app.call("GET", "/api/v1/rooms", { query: { include_inactive: "true" } });
    expect(names(asUser.body)).not.toContain("Studio 01");
    expect(asUser.body.find((room: { name: string }) => room.name === "The Library").facility_names.sort()).toEqual(["HDMI", "Projector"]);
    await asAdmin();
    const asManager = await app.call("GET", "/api/v1/rooms", { query: { include_inactive: "true" } });
    expect(names(asManager.body)).toContain("Studio 01");
  });

  it("filters by capacity and building", async () => {
    expect(names((await app.call("GET", "/api/v1/rooms", { query: { capacity: 14 } })).body)).toEqual(["Atrium Room", "The Library"]);
    expect((await app.call("GET", "/api/v1/rooms", { query: { building: "North House" } })).body).toHaveLength(2);
  });

  it("is managed by administrators and facility administrators only", async () => {
    const payload = { name: "Garden", building: "Annex", floor: "G", capacity: 6, facility_ids: [1, 2] };
    expect((await app.call("POST", "/api/v1/rooms", { json: payload })).status).toBe(403);
    app.signOut();
    expect((await app.call("POST", "/api/v1/rooms", { json: payload })).status).toBe(401);
    await app.signIn("fac@meetinghub.com", ADMIN[1]);
    const created = await app.call("POST", "/api/v1/rooms", { json: payload });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Garden", opens_at: "08:00", closes_at: "18:00", requires_approval: false, facility_ids: [1, 2] });
  });

  it("validates input, opening hours, duplicate names and facilities", async () => {
    await asAdmin();
    const create = (json: unknown) => app.call("POST", "/api/v1/rooms", { json });
    const base = { name: "Garden", building: "Annex", floor: "G", capacity: 6 };
    expect((await create({ ...base, capacity: 0 })).body.error.field).toBe("capacity");
    expect((await create({ ...base, opens_at: "9:00" })).body.error.field).toBe("opens_at");
    expect((await create({ ...base, opens_at: "10:00", closes_at: "09:00" })).body.error.field).toBe("closes_at");
    expect((await create({ ...base, image_url: "javascript:alert(1)" })).body.error.field).toBe("image_url");
    expect((await create({ ...base, image_url: "//evil.example/x.png" })).body.error.field).toBe("image_url");
    expect((await create({ ...base, facility_ids: [999] })).body.error.code).toBe("UNKNOWN_FACILITY");
    expect((await create({ ...base, name: "Studio 01" })).body.error.code).toBe("ROOM_NAME_TAKEN");
  });

  it("updates, deactivates and reactivates a room", async () => {
    await asAdmin();
    const id = roomId(app, "Focus Room");
    const patch = (json: unknown) => app.call("PATCH", `/api/v1/rooms/${id}`, { json });
    expect((await patch({ capacity: 5, facility_ids: [1] })).body).toMatchObject({ capacity: 5, facility_ids: [1] });
    expect((await patch({ closes_at: "07:00" })).body.error.code).toBe("INVALID_OPENING_HOURS");
    expect((await patch({ name: "Studio 01" })).status).toBe(409);
    expect((await patch({ capacity: null })).status).toBe(422);
    expect((await app.call("DELETE", `/api/v1/rooms/${id}`)).body.is_active).toBe(false);
    expect((await app.call("POST", `/api/v1/rooms/${id}/activate`)).body.is_active).toBe(true);
    expect((await app.call("PATCH", "/api/v1/rooms/9999", { json: { capacity: 5 } })).status).toBe(404);
    expect((await app.call("PATCH", "/api/v1/rooms/abc", { json: {} })).status).toBe(422);
  });
});

describe("room photos", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const upload = (id: number, file: File | null) => {
    const body = new FormData();
    if (file) body.set("image", file);
    return app.call("POST", `/api/v1/rooms/${id}/image`, { body });
  };

  it("stores a shrunk photo with the room and removes it again", async () => {
    await asAdmin();
    const id = roomId(app, "Studio 01");
    const stored = await upload(id, new File([PNG], "a.png", { type: "image/png" }));
    expect(stored.status).toBe(200);
    expect(stored.body.image_url).toMatch(/^data:image\/jpeg;base64,/);
    // The room list shows the same photo.
    const listed = (await app.call("GET", "/api/v1/rooms")).body.find((room: { id: number }) => room.id === id);
    expect(listed.image_url).toBe(stored.body.image_url);
    expect((await app.call("DELETE", `/api/v1/rooms/${id}/image`)).body.image_url).toBeNull();
  });

  it("rejects unsupported, fake and oversized images and non-managers", async () => {
    const id = roomId(app, "Studio 01");
    expect((await upload(id, new File([PNG], "a.png", { type: "image/png" }))).status).toBe(403);
    await asAdmin();
    expect((await upload(id, new File([PNG], "a.gif", { type: "image/gif" }))).body.error.code).toBe("UNSUPPORTED_IMAGE_TYPE");
    expect((await upload(id, new File(["not an image"], "a.png", { type: "image/png" }))).body.error.code).toBe("INVALID_IMAGE");
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    expect((await upload(id, big)).status).toBe(413);
    expect((await upload(id, null)).status).toBe(422);
    expect(app.data().room(id)!.image_url).toBe("/rooms/studio-01.png");
  });
});

describe("availability", () => {
  it("reports available, booked and maintenance rooms and filters by equipment", async () => {
    const organizer = userId(app, USER[0]);
    insertBooking(app, { room_id: roomId(app, "Studio 01"), organizer_id: organizer, starts_at: new Date(slot(3, 10)).toISOString(), ends_at: new Date(slot(3, 11)).toISOString() });
    await asAdmin();
    await app.call("POST", "/api/v1/maintenance", {
      json: { room_id: roomId(app, "The Library"), starts_at: slot(3, 9), ends_at: slot(3, 12), reason: "Paint" },
    });
    const response = await app.call("GET", "/api/v1/rooms/availability", { query: { starts_at: slot(3, 10), ends_at: slot(3, 11) } });
    const status = Object.fromEntries(response.body.map((room: { name: string; status: string }) => [room.name, room.status]));
    expect(status).toMatchObject({ "Studio 01": "Booked", "The Library": "Maintenance", "Focus Room": "Available" });

    const projector = app.data().data.facilities.find((facility) => facility.name === "Projector")!.id;
    const filtered = await app.call("GET", "/api/v1/rooms/availability", {
      query: { starts_at: slot(3, 10), ends_at: slot(3, 11), facility_ids: String(projector) },
    });
    expect(names(filtered.body)).toEqual(["Atrium Room", "The Library"]);
  });

  it("validates the period", async () => {
    const reversed = await app.call("GET", "/api/v1/rooms/availability", { query: { starts_at: slot(3, 11), ends_at: slot(3, 10) } });
    expect(reversed.body.error.code).toBe("INVALID_TIME_RANGE");
    expect((await app.call("GET", "/api/v1/rooms/availability", { query: { starts_at: "yesterday", ends_at: "today" } })).status).toBe(422);
    const wide = await app.call("GET", "/api/v1/rooms/occupancy", { query: { starts_at: slot(1, 8), ends_at: slot(12, 8) } });
    expect(wide.body.error.code).toBe("RANGE_TOO_LARGE");
  });

  it("lists occupancy of active rooms only", async () => {
    const organizer = userId(app, USER[0]);
    const studio = roomId(app, "Studio 01");
    const focus = roomId(app, "Focus Room");
    for (const room of [studio, focus]) {
      insertBooking(app, { room_id: room, organizer_id: organizer, title: "Sync", starts_at: new Date(slot(2, 10)).toISOString(), ends_at: new Date(slot(2, 11)).toISOString() });
    }
    const db = app.data();
    db.room(focus)!.is_active = false;
    app.commit(db);
    const response = await app.call("GET", "/api/v1/rooms/occupancy", { query: { starts_at: slot(2, 8), ends_at: slot(2, 18) } });
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ room_id: studio, kind: "booking", label: "Sync" });
  });
});

describe("check-in codes", () => {
  it("are issued to managers for one room, expire, and are refused for another room", async () => {
    const studio = roomId(app, "Studio 01");
    const library = roomId(app, "The Library");
    expect((await app.call("GET", `/api/v1/rooms/${studio}/check-in-token`)).status).toBe(403);
    await asAdmin();
    const issued = await app.call("GET", `/api/v1/rooms/${studio}/check-in-token`);
    expect(issued.body).toMatchObject({ expires_in: 120, room_name: "Studio 01" });
    expect(issued.body.token.length).toBeGreaterThanOrEqual(10);
    await app.signIn(...USER);
    const scan = (room: number, token: string) => app.call("POST", `/api/v1/rooms/${room}/check-in`, { json: { token } });
    expect((await scan(library, issued.body.token)).body.error.code).toBe("CHECK_IN_CODE_INVALID");
    expect((await scan(studio, "x".repeat(20))).body.error.code).toBe("CHECK_IN_CODE_INVALID");
    // A valid code for the right room but no booking due now.
    expect((await scan(studio, issued.body.token)).body.error.code).toBe("NO_BOOKING_TO_CHECK_IN");
    app.setNow(new Date(Date.now() + 3 * 60_000));
    expect((await scan(studio, issued.body.token)).body.error.code).toBe("CHECK_IN_CODE_EXPIRED");
  });
});
