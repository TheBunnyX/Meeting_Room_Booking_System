import type { BookingRec } from "../database";
import { LocalApiError } from "../errors";
import { localIso, startOfLocalDay } from "../time";
import type { MaintenanceInput } from "../validation";
import { type Ctx, audit, current, iso, requireRoles } from "./shared";

// Requests that never held the room do not count as the room being used.
const UNUSED_STATUSES = ["CANCELLED", "REJECTED"];
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

const maintenanceRead = (ctx: Ctx, item: { id: number; room_id: number; starts_at: string; ends_at: string; reason: string }) => ({
  id: item.id,
  room_id: item.room_id,
  starts_at: item.starts_at,
  ends_at: item.ends_at,
  reason: item.reason,
  room_name: ctx.db.room(item.room_id)?.name ?? "",
});

export function createMaintenance(ctx: Ctx, payload: MaintenanceInput) {
  const actor = requireRoles(ctx, "ADMIN", "FACILITY_ADMIN");
  if (!ctx.db.room(payload.room_id)) throw new LocalApiError(404, "ROOM_NOT_FOUND", "Room not found", "room_id");
  const item = {
    id: ctx.db.nextId(ctx.db.data.maintenance),
    room_id: payload.room_id,
    starts_at: iso(payload.starts_at),
    ends_at: iso(payload.ends_at),
    reason: payload.reason,
  };
  ctx.db.data.maintenance.push(item);
  audit(ctx, actor.id, "CREATE", "Maintenance", item.id, { room_id: item.room_id, reason: item.reason });
  return maintenanceRead(ctx, item);
}

export function listMaintenance(ctx: Ctx) {
  requireRoles(ctx, "ADMIN", "FACILITY_ADMIN");
  return [...ctx.db.data.maintenance].sort((a, b) => b.starts_at.localeCompare(a.starts_at)).map((item) => maintenanceRead(ctx, item));
}

export function removeMaintenance(ctx: Ctx, maintenanceId: number) {
  const actor = requireRoles(ctx, "ADMIN", "FACILITY_ADMIN");
  const index = ctx.db.data.maintenance.findIndex((item) => item.id === maintenanceId);
  if (index < 0) throw new LocalApiError(404, "MAINTENANCE_NOT_FOUND", "Maintenance record not found");
  const [item] = ctx.db.data.maintenance.splice(index, 1);
  audit(ctx, actor.id, "DELETE", "Maintenance", item.id, { room_id: item.room_id });
  return { message: "Maintenance record removed" };
}

/** Predicate selecting bookings that start inside the optional reporting period. */
function inPeriod(startsAt?: Date, endsAt?: Date) {
  if (startsAt && endsAt && endsAt <= startsAt) {
    throw new LocalApiError(400, "INVALID_TIME_RANGE", "End time must be after start time", "ends_at");
  }
  return (booking: BookingRec) => {
    const start = new Date(booking.starts_at);
    return (!startsAt || start >= startsAt) && (!endsAt || start < endsAt);
  };
}

export function dashboard(ctx: Ctx) {
  requireRoles(ctx, "ADMIN", "FACILITY_ADMIN");
  const dayStart = startOfLocalDay(ctx.now);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const { bookings, rooms } = ctx.db.data;
  return {
    bookings_today: bookings.filter((booking) => new Date(booking.starts_at) >= dayStart && new Date(booking.starts_at) < dayEnd).length,
    active_rooms: rooms.filter((room) => room.is_active).length,
    cancelled_bookings: bookings.filter((booking) => booking.status === "CANCELLED").length,
    no_shows: bookings.filter((booking) => booking.status === "NO_SHOW").length,
  };
}

const percent = (part: number, total: number) => (total ? Math.round((part / total) * 10_000) / 100 : 0);

export function reportSummary(ctx: Ctx, query: { starts_at?: Date; ends_at?: Date }) {
  requireRoles(ctx, "ADMIN", "FACILITY_ADMIN");
  const period = ctx.db.data.bookings.filter(inPeriod(query.starts_at, query.ends_at));
  const count = (status: string) => period.filter((booking) => booking.status === status).length;
  const total = period.length;
  const cancelled = count("CANCELLED");
  const noShows = count("NO_SHOW");
  const used = new Map<number, number>();
  for (const booking of period) {
    if (!UNUSED_STATUSES.includes(booking.status)) used.set(booking.room_id, (used.get(booking.room_id) ?? 0) + 1);
  }
  const mostUsed = ctx.db.data.rooms
    .map((room) => ({ room: room.name, bookings: used.get(room.id) ?? 0 }))
    .sort((a, b) => b.bookings - a.bookings || (a.room < b.room ? -1 : a.room > b.room ? 1 : 0))
    .slice(0, 5);
  return {
    total_bookings: total,
    cancelled_bookings: cancelled,
    rejected_bookings: count("REJECTED"),
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

export function bookingsCsv(ctx: Ctx, query: { starts_at?: Date; ends_at?: Date }) {
  requireRoles(ctx, "ADMIN", "FACILITY_ADMIN");
  const rows = ctx.db.data.bookings
    .filter(inPeriod(query.starts_at, query.ends_at))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.id - b.id)
    .slice(0, MAX_EXPORT_ROWS);
  const lines = [CSV_COLUMNS.join(",")];
  for (const booking of rows) {
    const room = ctx.db.room(booking.room_id);
    const organizer = ctx.db.user(booking.organizer_id);
    lines.push(
      [
        booking.id,
        room?.name,
        room?.building,
        booking.title,
        organizer?.full_name,
        organizer?.email,
        localIso(new Date(booking.starts_at)),
        localIso(new Date(booking.ends_at)),
        booking.status,
        booking.attendee_count,
        booking.checked_in_at ? localIso(new Date(booking.checked_in_at)) : "",
        booking.decision_note,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  // The byte-order mark makes Excel read the file as UTF-8, so Thai text displays correctly.
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function listAuditLogs(ctx: Ctx, query: { limit: number; offset: number; entity?: string }) {
  requireRoles(ctx, "ADMIN");
  return ctx.db.data.audit_logs
    .filter((log) => !query.entity || log.entity === query.entity)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
    .slice(query.offset, query.offset + query.limit)
    .map((log) => {
      const actor = log.user_id === null ? undefined : ctx.db.user(log.user_id);
      return {
        id: log.id,
        created_at: log.created_at,
        actor_name: actor?.full_name ?? null,
        actor_email: actor?.email ?? null,
        action: log.action,
        entity: log.entity,
        entity_id: log.entity_id,
        details: log.details,
      };
    });
}

export function listNotifications(ctx: Ctx, limit: number) {
  const user = current(ctx);
  const own = ctx.db.data.notifications.filter((item) => item.user_id === user.id);
  const items = [...own]
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
    .slice(0, limit)
    .map(({ id, title, message, link, is_read, created_at }) => ({ id, title, message, link, is_read, created_at }));
  return { items, unread_count: own.filter((item) => !item.is_read).length };
}

export function markNotificationRead(ctx: Ctx, notificationId: number) {
  const user = current(ctx);
  const item = ctx.db.data.notifications.find((candidate) => candidate.id === notificationId);
  // Someone else's notification is reported as missing so ids cannot be probed.
  if (!item || item.user_id !== user.id) throw new LocalApiError(404, "NOTIFICATION_NOT_FOUND", "Notification not found");
  item.is_read = true;
  const { id, title, message, link, is_read, created_at } = item;
  return { id, title, message, link, is_read, created_at };
}

export function markAllNotificationsRead(ctx: Ctx) {
  const user = current(ctx);
  for (const item of ctx.db.data.notifications) if (item.user_id === user.id) item.is_read = true;
  return { message: "All notifications marked as read" };
}

