import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as listFacilities } from "@/app/api/v1/facilities/route";
import { GET as availability } from "@/app/api/v1/rooms/availability/route";
import { GET as occupancy } from "@/app/api/v1/rooms/occupancy/route";
import { POST as activate } from "@/app/api/v1/rooms/[roomId]/activate/route";
import { POST as checkInAtRoom } from "@/app/api/v1/rooms/[roomId]/check-in/route";
import { GET as checkInToken } from "@/app/api/v1/rooms/[roomId]/check-in-token/route";
import { DELETE as deleteImage, POST as uploadImage } from "@/app/api/v1/rooms/[roomId]/image/route";
import { DELETE as deactivate, PATCH as updateRoom } from "@/app/api/v1/rooms/[roomId]/route";
import { GET as listRooms, POST as createRoom } from "@/app/api/v1/rooms/route";
import { db } from "@/lib/server/db";

import { call, createUser, resetDatabase, roomByName, signIn, slot } from "../support/app";

const blob = vi.hoisted(() => ({
  put: vi.fn(async (pathname: string) => ({ url: `https://store.public.blob.vercel-storage.com/${pathname}` })),
  del: vi.fn(async () => undefined),
  list: vi.fn(async () => ({ blobs: [], hasMore: false })),
}));
vi.mock("@vercel/blob", () => blob);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

let admin: string;
let user: string;

beforeEach(async () => {
  await resetDatabase();
  blob.put.mockClear();
  blob.del.mockClear();
  await createUser("fac@meetinghub.com", "FACILITY_ADMIN");
  admin = await signIn(login, "admin@meetinghub.com", "Admin123!");
  user = await signIn(login, "user@meetinghub.com", "User123!");
});

function upload(roomId: number, file: File, cookie = admin) {
  const body = new FormData();
  body.set("image", file);
  return call(uploadImage, "/x", { method: "POST", cookie, params: { roomId }, body });
}

describe("rooms", () => {
  it("lists active rooms with their equipment and hides inactive ones from non-managers", async () => {
    const studio = await roomByName("Studio 01");
    await db.room.update({ where: { id: studio.id }, data: { isActive: false } });
    const listed = await call(listRooms, "/api/v1/rooms", { cookie: user, query: { include_inactive: "true" } });
    expect(listed.body.map((room: { name: string }) => room.name)).not.toContain("Studio 01");
    const managed = await call(listRooms, "/api/v1/rooms", { cookie: admin, query: { include_inactive: "true" } });
    expect(managed.body.map((room: { name: string }) => room.name)).toContain("Studio 01");
    const library = listed.body.find((room: { name: string }) => room.name === "The Library");
    expect(library.facility_names.sort()).toEqual(["HDMI", "Projector"]);
  });

  it("filters by capacity and building", async () => {
    const big = await call(listRooms, "/api/v1/rooms", { cookie: user, query: { capacity: 14 } });
    expect(big.body.map((room: { name: string }) => room.name).sort()).toEqual(["Atrium Room", "The Library"]);
    const north = await call(listRooms, "/api/v1/rooms", { cookie: user, query: { building: "North House" } });
    expect(north.body).toHaveLength(2);
  });

  it("requires sign-in", async () => {
    expect((await call(listRooms, "/api/v1/rooms")).status).toBe(401);
    expect((await call(listFacilities, "/api/v1/facilities")).status).toBe(401);
    expect((await call(listFacilities, "/api/v1/facilities", { cookie: user })).body).toHaveLength(5);
  });

  it("is managed by administrators and facility administrators only", async () => {
    const payload = { name: "Garden", building: "Annex", floor: "G", capacity: 6 };
    expect((await call(createRoom, "/x", { method: "POST", cookie: user, json: payload })).status).toBe(403);
    const facility = await signIn(login, "fac@meetinghub.com", "Passw0rd!x");
    const created = await call(createRoom, "/x", { method: "POST", cookie: facility, json: { ...payload, facility_ids: [1, 2] } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Garden", opens_at: "08:00", closes_at: "18:00", requires_approval: false });
    expect(created.body.facility_ids).toEqual([1, 2]);
  });

  it("validates input, opening hours, duplicate names and facilities", async () => {
    const create = (json: unknown) => call(createRoom, "/x", { method: "POST", cookie: admin, json });
    const base = { name: "Garden", building: "Annex", floor: "G", capacity: 6 };
    expect((await create({ ...base, capacity: 0 })).body.error.field).toBe("capacity");
    expect((await create({ ...base, opens_at: "9:00" })).body.error.field).toBe("opens_at");
    expect((await create({ ...base, opens_at: "10:00", closes_at: "09:00" })).body.error.field).toBe("closes_at");
    expect((await create({ ...base, image_url: "javascript:alert(1)" })).body.error.field).toBe("image_url");
    expect((await create({ ...base, facility_ids: [999] })).body.error.code).toBe("UNKNOWN_FACILITY");
    expect((await create({ ...base, name: "Studio 01" })).body.error.code).toBe("ROOM_NAME_TAKEN");
  });

  it("updates, deactivates and reactivates a room", async () => {
    const room = await roomByName("Focus Room");
    const params = { roomId: room.id };
    const updated = await call(updateRoom, "/x", { method: "PATCH", cookie: admin, params, json: { capacity: 5, facility_ids: [1] } });
    expect(updated.body).toMatchObject({ capacity: 5, facility_ids: [1] });
    expect((await call(updateRoom, "/x", { method: "PATCH", cookie: admin, params, json: { closes_at: "07:00" } })).body.error.code).toBe("INVALID_OPENING_HOURS");
    expect((await call(updateRoom, "/x", { method: "PATCH", cookie: admin, params, json: { name: "Studio 01" } })).status).toBe(409);
    expect((await call(updateRoom, "/x", { method: "PATCH", cookie: admin, params, json: { capacity: null } })).status).toBe(422);
    expect((await call(deactivate, "/x", { method: "DELETE", cookie: admin, params })).body.is_active).toBe(false);
    expect((await call(activate, "/x", { method: "POST", cookie: admin, params })).body.is_active).toBe(true);
    expect((await call(updateRoom, "/x", { method: "PATCH", cookie: admin, params: { roomId: 9999 }, json: { capacity: 5 } })).status).toBe(404);
    expect((await call(updateRoom, "/x", { method: "PATCH", cookie: admin, params: { roomId: "abc" }, json: {} })).status).toBe(422);
  });
});

describe("room images", () => {
  it("stores an upload in Vercel Blob and replaces the previous one", async () => {
    const room = await roomByName("Studio 01");
    const first = await upload(room.id, new File([PNG], "a.png", { type: "image/png" }));
    expect(first.status).toBe(200);
    expect(first.body.image_url).toMatch(/^https:\/\/store\.public\.blob\.vercel-storage\.com\/rooms\/[0-9a-f]{32}\.png$/);
    expect(blob.put).toHaveBeenCalledTimes(1);
    // The bundled seed image is not a Blob file, so it is never deleted.
    expect(blob.del).not.toHaveBeenCalled();

    const second = await upload(room.id, new File([PNG], "b.png", { type: "image/png" }));
    expect(second.body.image_url).not.toBe(first.body.image_url);
    expect(blob.del).toHaveBeenCalledWith(first.body.image_url);

    const removed = await call(deleteImage, "/x", { method: "DELETE", cookie: admin, params: { roomId: room.id } });
    expect(removed.body.image_url).toBeNull();
    expect(blob.del).toHaveBeenCalledWith(second.body.image_url);
  });

  it("rejects unsupported, fake and oversized images and non-managers", async () => {
    const room = await roomByName("Studio 01");
    expect((await upload(room.id, new File([PNG], "a.gif", { type: "image/gif" }))).body.error.code).toBe("UNSUPPORTED_IMAGE_TYPE");
    expect((await upload(room.id, new File(["not an image"], "a.png", { type: "image/png" }))).body.error.code).toBe("INVALID_IMAGE");
    const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    expect((await upload(room.id, big)).status).toBe(413);
    expect((await upload(room.id, new File([PNG], "a.png", { type: "image/png" }), user)).status).toBe(403);
    expect(blob.put).not.toHaveBeenCalled();
    const missing = await call(uploadImage, "/x", { method: "POST", cookie: admin, params: { roomId: room.id }, body: new FormData() });
    expect(missing.status).toBe(422);
  });

  it("explains when storage is not configured", async () => {
    const room = await roomByName("Studio 01");
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    try {
      const response = await upload(room.id, new File([PNG], "a.png", { type: "image/png" }));
      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe("STORAGE_NOT_CONFIGURED");
    } finally {
      process.env.BLOB_READ_WRITE_TOKEN = token;
    }
  });
});

describe("availability", () => {
  it("reports available, booked and maintenance rooms and filters by equipment", async () => {
    const studio = await roomByName("Studio 01");
    const library = await roomByName("The Library");
    const organizer = await db.user.findUniqueOrThrow({ where: { email: "user@meetinghub.com" } });
    await db.booking.create({
      data: {
        roomId: studio.id, organizerId: organizer.id, title: "Sync", attendeeCount: 2, status: "CONFIRMED",
        startsAt: new Date(slot(3, 10)), endsAt: new Date(slot(3, 11)),
      },
    });
    await db.maintenance.create({
      data: { roomId: library.id, startsAt: new Date(slot(3, 9)), endsAt: new Date(slot(3, 12)), reason: "Paint" },
    });
    const response = await call(availability, "/x", { cookie: user, query: { starts_at: slot(3, 10), ends_at: slot(3, 11) } });
    const byName = Object.fromEntries(response.body.map((room: { name: string; status: string }) => [room.name, room.status]));
    expect(byName).toMatchObject({ "Studio 01": "Booked", "The Library": "Maintenance", "Focus Room": "Available" });

    const projector = await db.facility.findUniqueOrThrow({ where: { name: "Projector" } });
    const filtered = await call(availability, "/x", {
      cookie: user,
      query: { starts_at: slot(3, 10), ends_at: slot(3, 11), facility_ids: String(projector.id) },
    });
    expect(filtered.body.map((room: { name: string }) => room.name).sort()).toEqual(["Atrium Room", "The Library"]);
  });

  it("validates the period", async () => {
    const reversed = await call(availability, "/x", { cookie: user, query: { starts_at: slot(3, 11), ends_at: slot(3, 10) } });
    expect(reversed.body.error.code).toBe("INVALID_TIME_RANGE");
    expect((await call(availability, "/x", { cookie: user, query: { starts_at: "yesterday", ends_at: "today" } })).status).toBe(422);
    const wide = await call(occupancy, "/x", { cookie: user, query: { starts_at: slot(1, 8), ends_at: slot(12, 8) } });
    expect(wide.body.error.code).toBe("RANGE_TOO_LARGE");
  });

  it("lists occupancy of active rooms only", async () => {
    const studio = await roomByName("Studio 01");
    const focus = await roomByName("Focus Room");
    const organizer = await db.user.findUniqueOrThrow({ where: { email: "user@meetinghub.com" } });
    for (const roomId of [studio.id, focus.id]) {
      await db.booking.create({
        data: { roomId, organizerId: organizer.id, title: "Sync", attendeeCount: 1, startsAt: new Date(slot(2, 10)), endsAt: new Date(slot(2, 11)) },
      });
    }
    await db.room.update({ where: { id: focus.id }, data: { isActive: false } });
    const response = await call(occupancy, "/x", { cookie: user, query: { starts_at: slot(2, 8), ends_at: slot(2, 18) } });
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ room_id: studio.id, kind: "booking", label: "Sync" });
  });
});

describe("check-in codes", () => {
  it("are issued to managers for one room only and are rejected for another room", async () => {
    const studio = await roomByName("Studio 01");
    const library = await roomByName("The Library");
    expect((await call(checkInToken, "/x", { cookie: user, params: { roomId: studio.id } })).status).toBe(403);
    const issued = await call(checkInToken, "/x", { cookie: admin, params: { roomId: studio.id } });
    expect(issued.body).toMatchObject({ expires_in: 120, room_name: "Studio 01" });
    const scan = (roomId: number, token: string) =>
      call(checkInAtRoom, "/x", { method: "POST", cookie: user, params: { roomId }, json: { token } });
    expect((await scan(library.id, issued.body.token)).body.error.code).toBe("CHECK_IN_CODE_INVALID");
    expect((await scan(studio.id, "x".repeat(20))).body.error.code).toBe("CHECK_IN_CODE_INVALID");
    // A valid code for the right room but no booking due now.
    expect((await scan(studio.id, issued.body.token)).body.error.code).toBe("NO_BOOKING_TO_CHECK_IN");
    // A session token is not a check-in code.
    const session = (await call(login, "/x", { method: "POST", json: { email: "user@meetinghub.com", password: "User123!" } })).body.access_token;
    expect((await scan(studio.id, session)).body.error.code).toBe("CHECK_IN_CODE_INVALID");
  });
});
