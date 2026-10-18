import { BookingStatus, type Prisma, type User } from "@prisma/client";

import { db } from "../db";
import { AppError } from "../errors";
import { days, localIso, startOfLocalDay } from "../time";
import type { MaintenanceInput } from "../validation";
import { bookingRelations } from "./bookings";

// Requests that never held the room do not count as the room being used.
const UNUSED_STATUSES: BookingStatus[] = [BookingStatus.CANCELLED, BookingStatus.REJECTED];
const MAX_EXPORT_ROWS = 50_000;
const CSV_COLUMNS = [
  "id",
  "room",
  "building",
  "title",
  "organizer",
  "organizer_email",
  "starts_at",
  "ends_at",
  "status",
  "attendees",
  "checked_in_at",
  "decision_note",
];

export async function createMaintenance(actor: User, payload: MaintenanceInput) {
  if (!(await db.room.findUnique({ where: { id: payload.room_id }, select: { id: true } }))) {
    throw new AppError(404, "ROOM_NOT_FOUND", "Room not found", "room_id");
  }
  return db.$transaction(async (tx) => {
    const item = await tx.maintenance.create({
      data: { roomId: payload.room_id, startsAt: payload.starts_at, endsAt: payload.ends_at, reason: payload.reason },
      include: { room: true },
    });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: "CREATE",
        entity: "Maintenance",
        entityId: String(item.id),
        details: { room_id: item.roomId, reason: item.reason },
      },
    });
    return item;
  });
}

export const listMaintenance = () => db.maintenance.findMany({ include: { room: true }, orderBy: { startsAt: "desc" } });

export async function removeMaintenance(actor: User, maintenanceId: number) {
  const item = await db.maintenance.findUnique({ where: { id: maintenanceId } });
  if (!item) throw new AppError(404, "MAINTENANCE_NOT_FOUND", "Maintenance record not found");
  await db.$transaction([
    db.auditLog.create({
      data: {
        userId: actor.id,
        action: "DELETE",
        entity: "Maintenance",
        entityId: String(item.id),
        details: { room_id: item.roomId },
      },
    }),
    db.maintenance.delete({ where: { id: item.id } }),
  ]);
}

/** Filters selecting bookings that start inside the optional reporting period. */
function periodWhere(startsAt?: Date, endsAt?: Date): Prisma.BookingWhereInput {
  if (startsAt && endsAt && endsAt <= startsAt) {
    throw new AppError(400, "INVALID_TIME_RANGE", "End time must be after start time", "ends_at");
  }
  const startsAtFilter: Prisma.DateTimeFilter = {};
  if (startsAt) startsAtFilter.gte = startsAt;
  if (endsAt) startsAtFilter.lt = endsAt;
  return startsAt || endsAt ? { startsAt: startsAtFilter } : {};
}

export async function dashboard() {
  const dayStart = startOfLocalDay(new Date());
  const dayEnd = new Date(dayStart.getTime() + days(1));
  const [bookingsToday, activeRooms, cancelled, noShows] = await Promise.all([
    db.booking.count({ where: { startsAt: { gte: dayStart, lt: dayEnd } } }),
    db.room.count({ where: { isActive: true } }),
    db.booking.count({ where: { status: BookingStatus.CANCELLED } }),
    db.booking.count({ where: { status: BookingStatus.NO_SHOW } }),
  ]);
  return { bookings_today: bookingsToday, active_rooms: activeRooms, cancelled_bookings: cancelled, no_shows: noShows };
}

const percent = (part: number, total: number) => (total ? Math.round((part / total) * 10_000) / 100 : 0);

export async function reportSummary(startsAt?: Date, endsAt?: Date) {
  const period = periodWhere(startsAt, endsAt);
  const countWhere = (status?: BookingStatus) => db.booking.count({ where: { ...period, ...(status ? { status } : {}) } });
  const [total, cancelled, rejected, noShows, usage, rooms] = await Promise.all([
    countWhere(),
    countWhere(BookingStatus.CANCELLED),
    countWhere(BookingStatus.REJECTED),
    countWhere(BookingStatus.NO_SHOW),
    db.booking.groupBy({
      by: ["roomId"],
      where: { ...period, status: { notIn: UNUSED_STATUSES } },
      _count: { _all: true },
    }),
    db.room.findMany({ select: { id: true, name: true } }),
  ]);
  const used = new Map(usage.map((row) => [row.roomId, row._count._all]));
  const mostUsed = rooms
    .map((room) => ({ room: room.name, bookings: used.get(room.id) ?? 0 }))
    .sort((a, b) => b.bookings - a.bookings || (a.room < b.room ? -1 : a.room > b.room ? 1 : 0))
    .slice(0, 5);
  return {
    total_bookings: total,
    cancelled_bookings: cancelled,
    rejected_bookings: rejected,
    no_show_bookings: noShows,
    cancellation_rate: percent(cancelled, total),
    no_show_rate: percent(noShows, total),
    most_used_rooms: mostUsed,
  };
}

/** Render a cell, neutralising values a spreadsheet would otherwise run as a formula. */
export function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export async function bookingsCsv(startsAt?: Date, endsAt?: Date) {
  const bookings = await db.booking.findMany({
    where: periodWhere(startsAt, endsAt),
    include: bookingRelations,
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    take: MAX_EXPORT_ROWS,
  });
  const lines = [CSV_COLUMNS.join(",")];
  for (const booking of bookings) {
    lines.push(
      [
        booking.id,
        booking.room.name,
        booking.room.building,
        booking.title,
        booking.organizer.fullName,
        booking.organizer.email,
        localIso(booking.startsAt),
        localIso(booking.endsAt),
        booking.status,
        booking.attendeeCount,
        localIso(booking.checkedInAt),
        booking.decisionNote,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  // The byte-order mark makes Excel read the file as UTF-8, so Thai text displays correctly.
  return `﻿${lines.join("\r\n")}\r\n`;
}

export async function listAuditLogs(limit: number, offset: number, entity?: string) {
  return db.auditLog.findMany({
    where: entity ? { entity } : {},
    include: { user: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    skip: offset,
  });
}
