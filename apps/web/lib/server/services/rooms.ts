import { randomUUID } from "node:crypto";

import type { Prisma, User } from "@prisma/client";

import { removeRoomImage, uploadRoomImage } from "../blob";
import { type Db, db, isUniqueViolation } from "../db";
import { AppError } from "../errors";
import { type RoomWithFacilities, roomRead } from "../serializers";
import { days } from "../time";
import type { RoomInput, RoomUpdate } from "../validation";
import { ACTIVE_STATUSES } from "./bookings";

// Vercel functions accept request bodies up to 4.5 MB, so uploads are capped just below that.
export const MAX_ROOM_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_OCCUPANCY_RANGE_MS = days(7);
const ROOM_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};
const withFacilities = { facilities: { orderBy: { id: "asc" } } } satisfies Prisma.RoomInclude;

export async function getRoom(id: number, client: Db = db): Promise<RoomWithFacilities> {
  const room = await client.room.findUnique({ where: { id }, include: withFacilities });
  if (!room) throw new AppError(404, "ROOM_NOT_FOUND", "Room not found");
  return room;
}

export const listFacilities = () => db.facility.findMany({ orderBy: { name: "asc" } });

async function loadFacilityIds(client: Db, facilityIds: number[]) {
  const wanted = [...new Set(facilityIds)];
  if (wanted.length === 0) return [];
  const found = await client.facility.findMany({ where: { id: { in: wanted } }, select: { id: true } });
  if (found.length !== wanted.length) {
    throw new AppError(422, "UNKNOWN_FACILITY", "One or more facilities do not exist", "facility_ids");
  }
  return wanted.map((id) => ({ id }));
}

export function listRooms(capacity: number | undefined, building: string | undefined, includeInactive: boolean) {
  return db.room.findMany({
    where: {
      ...(includeInactive ? {} : { isActive: true }),
      ...(capacity ? { capacity: { gte: capacity } } : {}),
      ...(building ? { building } : {}),
    },
    include: withFacilities,
    orderBy: { name: "asc" },
  });
}

const nameTaken = () => new AppError(409, "ROOM_NAME_TAKEN", "A room with this name already exists", "name");

async function ensureNameAvailable(client: Db, name: string, excludeRoomId?: number) {
  const existing = await client.room.findFirst({
    where: { name, ...(excludeRoomId === undefined ? {} : { id: { not: excludeRoomId } }) },
    select: { id: true },
  });
  if (existing) throw nameTaken();
}

const auditRoom = (client: Db, actor: User, action: string, roomId: number, details?: Prisma.InputJsonValue) =>
  client.auditLog.create({
    data: { userId: actor.id, action, entity: "Room", entityId: String(roomId), details },
  });

export async function createRoom(actor: User, payload: RoomInput) {
  try {
    return await db.$transaction(async (tx) => {
      await ensureNameAvailable(tx, payload.name);
      const facilities = await loadFacilityIds(tx, payload.facility_ids);
      const room = await tx.room.create({
        data: {
          name: payload.name,
          building: payload.building,
          floor: payload.floor,
          capacity: payload.capacity,
          imageUrl: payload.image_url ?? null,
          opensAt: payload.opens_at,
          closesAt: payload.closes_at,
          requiresApproval: payload.requires_approval,
          facilities: { connect: facilities },
        },
        include: withFacilities,
      });
      await auditRoom(tx, actor, "CREATE", room.id, { name: room.name });
      return room;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken();
    throw error;
  }
}

export async function updateRoom(actor: User, roomId: number, payload: RoomUpdate) {
  const room = await getRoom(roomId);
  if (payload.name !== undefined && payload.name !== room.name) await ensureNameAvailable(db, payload.name, room.id);
  if ((payload.closes_at ?? room.closesAt) <= (payload.opens_at ?? room.opensAt)) {
    throw new AppError(422, "INVALID_OPENING_HOURS", "Closing time must be after opening time", "closes_at");
  }
  const data: Prisma.RoomUpdateInput = {};
  if (payload.name !== undefined) data.name = payload.name;
  if (payload.building !== undefined) data.building = payload.building;
  if (payload.floor !== undefined) data.floor = payload.floor;
  if (payload.capacity !== undefined) data.capacity = payload.capacity;
  if (payload.image_url !== undefined) data.imageUrl = payload.image_url;
  if (payload.opens_at !== undefined) data.opensAt = payload.opens_at;
  if (payload.closes_at !== undefined) data.closesAt = payload.closes_at;
  if (payload.requires_approval !== undefined) data.requiresApproval = payload.requires_approval;
  if (payload.is_active !== undefined) data.isActive = payload.is_active;
  const fields = Object.entries(payload)
    .filter(([, value]) => value !== undefined)
    .map(([name]) => name)
    .sort();
  try {
    const updated = await db.$transaction(async (tx) => {
      if (payload.facility_ids) data.facilities = { set: await loadFacilityIds(tx, payload.facility_ids) };
      const result = await tx.room.update({ where: { id: room.id }, data, include: withFacilities });
      await auditRoom(tx, actor, "UPDATE", room.id, { fields });
      return result;
    });
    if (updated.imageUrl !== room.imageUrl) await removeRoomImage(room.imageUrl);
    return updated;
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken();
    throw error;
  }
}

export async function setRoomActive(actor: User, roomId: number, isActive: boolean) {
  const room = await getRoom(roomId);
  return db.$transaction(async (tx) => {
    const updated = await tx.room.update({ where: { id: room.id }, data: { isActive }, include: withFacilities });
    await auditRoom(tx, actor, isActive ? "ACTIVATE" : "DEACTIVATE", room.id);
    return updated;
  });
}

function imageSignatureMatches(contentType: string, content: Uint8Array) {
  const starts = (bytes: number[], offset = 0) => bytes.every((byte, index) => content[offset + index] === byte);
  if (contentType === "image/jpeg") return starts([0xff, 0xd8, 0xff]);
  if (contentType === "image/png") return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (contentType === "image/webp") return starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8);
  return false;
}

export async function replaceRoomImage(roomId: number, contentType: string, content: Uint8Array) {
  const room = await getRoom(roomId);
  const extension = ROOM_IMAGE_TYPES[contentType];
  if (!extension) {
    throw new AppError(415, "UNSUPPORTED_IMAGE_TYPE", "Only JPG, PNG, and WebP images are supported", "image");
  }
  if (content.byteLength > MAX_ROOM_IMAGE_BYTES) {
    throw new AppError(413, "IMAGE_TOO_LARGE", "Room images must be 4 MB or smaller", "image");
  }
  if (!imageSignatureMatches(contentType, content)) {
    throw new AppError(415, "INVALID_IMAGE", "The uploaded file is not a valid image", "image");
  }
  const url = await uploadRoomImage(`${randomUUID().replaceAll("-", "")}${extension}`, content, contentType);
  let updated: RoomWithFacilities;
  try {
    updated = await db.room.update({ where: { id: room.id }, data: { imageUrl: url }, include: withFacilities });
  } catch (error) {
    await removeRoomImage(url);
    throw error;
  }
  await removeRoomImage(room.imageUrl);
  return updated;
}

export async function deleteRoomImage(roomId: number) {
  const room = await getRoom(roomId);
  const updated = await db.room.update({ where: { id: room.id }, data: { imageUrl: null }, include: withFacilities });
  await removeRoomImage(room.imageUrl);
  return updated;
}

export async function roomAvailability(
  startsAt: Date,
  endsAt: Date,
  capacity: number | undefined,
  building: string | undefined,
  facilityIds: Set<number>,
) {
  if (endsAt <= startsAt) throw new AppError(400, "INVALID_TIME_RANGE", "End time must be after start time", "ends_at");
  const rooms = (await listRooms(capacity, building, false)).filter((room) => {
    const have = new Set(room.facilities.map((facility) => facility.id));
    return [...facilityIds].every((id) => have.has(id));
  });
  const roomIds = rooms.map((room) => room.id);
  const firstBooking = new Map<number, Date>();
  let blocked = new Set<number>();
  if (roomIds.length > 0) {
    const overlapping = await db.booking.findMany({
      where: {
        roomId: { in: roomIds },
        status: { in: ACTIVE_STATUSES },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
      orderBy: { startsAt: "asc" },
      select: { roomId: true, startsAt: true },
    });
    for (const booking of overlapping) if (!firstBooking.has(booking.roomId)) firstBooking.set(booking.roomId, booking.startsAt);
    const maintenance = await db.maintenance.findMany({
      where: { roomId: { in: roomIds }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
      select: { roomId: true },
    });
    blocked = new Set(maintenance.map((item) => item.roomId));
  }
  return rooms.map((room) => {
    const next = firstBooking.get(room.id);
    const status = blocked.has(room.id) ? "Maintenance" : next ? "Booked" : "Available";
    return { ...roomRead(room), status, next_booking_starts_at: next ?? null };
  });
}

/** Everything that blocks active rooms in a period: active bookings and maintenance windows. */
export async function roomOccupancy(startsAt: Date, endsAt: Date) {
  if (endsAt <= startsAt) throw new AppError(400, "INVALID_TIME_RANGE", "End time must be after start time", "ends_at");
  if (endsAt.getTime() - startsAt.getTime() > MAX_OCCUPANCY_RANGE_MS) {
    throw new AppError(400, "RANGE_TOO_LARGE", "The range cannot exceed 7 days", "ends_at");
  }
  const [bookings, maintenance] = await Promise.all([
    db.booking.findMany({
      where: {
        room: { isActive: true },
        status: { in: ACTIVE_STATUSES },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
      orderBy: { startsAt: "asc" },
    }),
    db.maintenance.findMany({
      where: { room: { isActive: true }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
      orderBy: { startsAt: "asc" },
    }),
  ]);
  return [
    ...bookings.map((booking) => ({
      room_id: booking.roomId,
      kind: "booking" as const,
      starts_at: booking.startsAt,
      ends_at: booking.endsAt,
      label: booking.title,
      status: booking.status,
    })),
    ...maintenance.map((item) => ({
      room_id: item.roomId,
      kind: "maintenance" as const,
      starts_at: item.startsAt,
      ends_at: item.endsAt,
      label: "Maintenance",
      status: null,
    })),
  ];
}
