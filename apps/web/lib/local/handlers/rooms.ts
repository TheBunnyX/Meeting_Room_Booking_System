import type { RoomRec } from "../database";
import { LocalApiError } from "../errors";
import { randomToken } from "../password";
import type { RoomInput, RoomUpdate } from "../validation";
import { ACTIVE_STATUSES, MANAGER_ROLES, type Ctx, audit, current, iso, requireRoles, roomRead } from "./shared";

export const MAX_ROOM_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_OCCUPANCY_RANGE_MS = 7 * 86_400_000;
const CHECK_IN_CODE_SECONDS = 120;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

function getRoom(ctx: Ctx, id: number): RoomRec {
  const room = ctx.db.room(id);
  if (!room) throw new LocalApiError(404, "ROOM_NOT_FOUND", "Room not found");
  return room;
}

export function listFacilities(ctx: Ctx) {
  current(ctx);
  return [...ctx.db.data.facilities].sort((a, b) => a.name.localeCompare(b.name));
}

function filteredRooms(ctx: Ctx, capacity: number | undefined, building: string | undefined, includeInactive: boolean) {
  return ctx.db.data.rooms
    .filter((room) => (includeInactive || room.is_active) && (!capacity || room.capacity >= capacity) && (!building || room.building === building))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listRooms(ctx: Ctx, query: { capacity?: number; building?: string; include_inactive?: boolean }) {
  const user = current(ctx);
  const includeInactive = Boolean(query.include_inactive) && MANAGER_ROLES.includes(user.role);
  return filteredRooms(ctx, query.capacity, query.building, includeInactive).map((room) => roomRead(ctx.db, room));
}

function checkFacilities(ctx: Ctx, ids: number[]) {
  const wanted = [...new Set(ids)];
  if (wanted.some((id) => !ctx.db.data.facilities.some((facility) => facility.id === id))) {
    throw new LocalApiError(422, "UNKNOWN_FACILITY", "One or more facilities do not exist", "facility_ids");
  }
  return wanted;
}

const nameTaken = () => new LocalApiError(409, "ROOM_NAME_TAKEN", "A room with this name already exists", "name");

export function createRoom(ctx: Ctx, payload: RoomInput) {
  const actor = requireRoles(ctx, "ADMIN", "FACILITY_ADMIN");
  if (ctx.db.data.rooms.some((room) => room.name === payload.name)) throw nameTaken();
  const facilityIds = checkFacilities(ctx, payload.facility_ids);
  const room: RoomRec = {
    id: ctx.db.nextId(ctx.db.data.rooms),
    name: payload.name,
    building: payload.building,
    floor: payload.floor,
    capacity: payload.capacity,
    image_url: payload.image_url ?? null,
    opens_at: payload.opens_at,
    closes_at: payload.closes_at,
    requires_approval: payload.requires_approval,
    is_active: true,
    facility_ids: facilityIds,
  };
  ctx.db.data.rooms.push(room);
  audit(ctx, actor.id, "CREATE", "Room", room.id, { name: room.name });
  return roomRead(ctx.db, room);
}

export function updateRoom(ctx: Ctx, roomId: number, payload: RoomUpdate) {
  const actor = requireRoles(ctx, "ADMIN", "FACILITY_ADMIN");
  const room = getRoom(ctx, roomId);
  if (payload.name !== undefined && payload.name !== room.name && ctx.db.data.rooms.some((other) => other.name === payload.name)) {
    throw nameTaken();
  }
  if ((payload.closes_at ?? room.closes_at) <= (payload.opens_at ?? room.opens_at)) {
    throw new LocalApiError(422, "INVALID_OPENING_HOURS", "Closing time must be after opening time", "closes_at");
  }
  const facilityIds = payload.facility_ids ? checkFacilities(ctx, payload.facility_ids) : undefined;
  if (payload.name !== undefined) room.name = payload.name;
  if (payload.building !== undefined) room.building = payload.building;
  if (payload.floor !== undefined) room.floor = payload.floor;
  if (payload.capacity !== undefined) room.capacity = payload.capacity;
  if (payload.image_url !== undefined) room.image_url = payload.image_url;
  if (payload.opens_at !== undefined) room.opens_at = payload.opens_at;
  if (payload.closes_at !== undefined) room.closes_at = payload.closes_at;
  if (payload.requires_approval !== undefined) room.requires_approval = payload.requires_approval;
  if (payload.is_active !== undefined) room.is_active = payload.is_active;
  if (facilityIds) room.facility_ids = facilityIds;
  const fields = Object.entries(payload)
    .filter(([, value]) => value !== undefined)
    .map(([name]) => name)
    .sort();
  audit(ctx, actor.id, "UPDATE", "Room", room.id, { fields });
  return roomRead(ctx.db, room);
}

export function setRoomActive(ctx: Ctx, roomId: number, isActive: boolean) {
  const actor = requireRoles(ctx, "ADMIN", "FACILITY_ADMIN");
  const room = getRoom(ctx, roomId);
  room.is_active = isActive;
  audit(ctx, actor.id, isActive ? "ACTIVATE" : "DEACTIVATE", "Room", room.id);
  return roomRead(ctx.db, room);
}

function signatureMatches(type: string, bytes: Uint8Array) {
  const starts = (expected: number[], offset = 0) => expected.every((byte, index) => bytes[offset + index] === byte);
  if (type === "image/jpeg") return starts([0xff, 0xd8, 0xff]);
  if (type === "image/png") return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (type === "image/webp") return starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8);
  return false;
}

/** The photo is shrunk and kept inside the room record as a data URL, because there is no file storage. */
export async function uploadRoomImage(ctx: Ctx, roomId: number, form: FormData | null | undefined) {
  requireRoles(ctx, "ADMIN", "FACILITY_ADMIN");
  const room = getRoom(ctx, roomId);
  const image = form?.get("image");
  if (!(image instanceof File)) throw new LocalApiError(422, "VALIDATION_ERROR", "An image file is required", "image");
  if (!IMAGE_TYPES.includes(image.type)) {
    throw new LocalApiError(415, "UNSUPPORTED_IMAGE_TYPE", "Only JPG, PNG, and WebP images are supported", "image");
  }
  if (image.size > MAX_ROOM_IMAGE_BYTES) {
    throw new LocalApiError(413, "IMAGE_TOO_LARGE", "Room images must be 5 MB or smaller", "image");
  }
  const head = new Uint8Array(await image.slice(0, 12).arrayBuffer());
  if (!signatureMatches(image.type, head)) {
    throw new LocalApiError(415, "INVALID_IMAGE", "The uploaded file is not a valid image", "image");
  }
  room.image_url = await ctx.encodeImage(image);
  return roomRead(ctx.db, room);
}

export function deleteRoomImage(ctx: Ctx, roomId: number) {
  requireRoles(ctx, "ADMIN", "FACILITY_ADMIN");
  const room = getRoom(ctx, roomId);
  room.image_url = null;
  return roomRead(ctx.db, room);
}

function overlaps(startsAt: string, endsAt: string, from: Date, to: Date) {
  return new Date(startsAt) < to && new Date(endsAt) > from;
}

export function roomAvailability(
  ctx: Ctx,
  query: { starts_at: Date; ends_at: Date; capacity?: number; building?: string; facility_ids?: string },
) {
  current(ctx);
  if (query.ends_at <= query.starts_at) {
    throw new LocalApiError(400, "INVALID_TIME_RANGE", "End time must be after start time", "ends_at");
  }
  const wanted = (query.facility_ids ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^\d+$/.test(item))
    .map(Number);
  const rooms = filteredRooms(ctx, query.capacity, query.building, false).filter((room) =>
    wanted.every((id) => room.facility_ids.includes(id)),
  );
  return rooms.map((room) => {
    const next = ctx.db.data.bookings
      .filter((booking) => booking.room_id === room.id && ACTIVE_STATUSES.includes(booking.status) && overlaps(booking.starts_at, booking.ends_at, query.starts_at, query.ends_at))
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
    const blocked = ctx.db.data.maintenance.some((item) => item.room_id === room.id && overlaps(item.starts_at, item.ends_at, query.starts_at, query.ends_at));
    const status = blocked ? "Maintenance" : next ? "Booked" : "Available";
    return { ...roomRead(ctx.db, room), status, next_booking_starts_at: next?.starts_at ?? null };
  });
}

/** Everything that blocks active rooms in a period: active bookings and maintenance windows. */
export function roomOccupancy(ctx: Ctx, query: { starts_at: Date; ends_at: Date }) {
  current(ctx);
  if (query.ends_at <= query.starts_at) {
    throw new LocalApiError(400, "INVALID_TIME_RANGE", "End time must be after start time", "ends_at");
  }
  if (query.ends_at.getTime() - query.starts_at.getTime() > MAX_OCCUPANCY_RANGE_MS) {
    throw new LocalApiError(400, "RANGE_TOO_LARGE", "The range cannot exceed 7 days", "ends_at");
  }
  const active = new Set(ctx.db.data.rooms.filter((room) => room.is_active).map((room) => room.id));
  const bookings = ctx.db.data.bookings
    .filter((booking) => active.has(booking.room_id) && ACTIVE_STATUSES.includes(booking.status) && overlaps(booking.starts_at, booking.ends_at, query.starts_at, query.ends_at))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .map((booking) => ({
      room_id: booking.room_id,
      kind: "booking" as const,
      starts_at: booking.starts_at,
      ends_at: booking.ends_at,
      label: booking.title,
      status: booking.status,
    }));
  const maintenance = ctx.db.data.maintenance
    .filter((item) => active.has(item.room_id) && overlaps(item.starts_at, item.ends_at, query.starts_at, query.ends_at))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .map((item) => ({
      room_id: item.room_id,
      kind: "maintenance" as const,
      starts_at: item.starts_at,
      ends_at: item.ends_at,
      label: "Maintenance",
      status: null,
    }));
  return [...bookings, ...maintenance];
}

/** A fresh code for the screen at the room to show as a QR code. Managers only. */
export function checkInToken(ctx: Ctx, roomId: number) {
  requireRoles(ctx, "ADMIN", "FACILITY_ADMIN");
  const room = getRoom(ctx, roomId);
  // Expired codes are useless; dropping them keeps the stored data small.
  ctx.db.data.check_in_codes = ctx.db.data.check_in_codes.filter((code) => new Date(code.expires_at) > ctx.now);
  const code = randomToken(16);
  ctx.db.data.check_in_codes.push({
    code,
    room_id: room.id,
    expires_at: iso(new Date(ctx.now.getTime() + CHECK_IN_CODE_SECONDS * 1000)),
  });
  return { token: code, expires_in: CHECK_IN_CODE_SECONDS, room_name: room.name };
}

/** Accept only an unexpired code that was issued for this room. */
export function verifyCheckInCode(ctx: Ctx, token: string, roomId: number) {
  const match = ctx.db.data.check_in_codes.find((code) => code.code === token && code.room_id === roomId);
  if (!match) {
    throw new LocalApiError(400, "CHECK_IN_CODE_INVALID", "This code is not valid. Scan the code on the screen at the room.");
  }
  if (new Date(match.expires_at) <= ctx.now) {
    throw new LocalApiError(
      400,
      "CHECK_IN_CODE_EXPIRED",
      "This code has expired. Scan the code on the screen at the room again.",
    );
  }
}
