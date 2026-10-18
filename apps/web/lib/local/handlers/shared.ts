import type { Booking, Role as UiRole } from "../../types";
import type { BookingRec, BookingStatus, Database, RoomRec, Role, UserRec } from "../database";
import { LocalApiError } from "../errors";
import { formatWhen } from "../time";

export type SessionRec = { user_id: number; token_version: number; expires_at: string };

/** Everything a request handler needs. Built per request by the router. */
export type Ctx = {
  db: Database;
  now: Date;
  getSession: () => SessionRec | null;
  setSession: (session: SessionRec | null) => void;
  /** Turns an uploaded image into a small data URL. Replaced in tests, where there is no canvas. */
  encodeImage: (file: File) => Promise<string>;
  hashIterations: number;
};

export const ACTIVE_STATUSES: BookingStatus[] = ["CONFIRMED", "PENDING_APPROVAL"];
export const MANAGER_ROLES: Role[] = ["ADMIN", "FACILITY_ADMIN"];
export const SESSION_MINUTES = 480;

/** Resolve the signed-in user, including one who still has to replace a temporary password. */
export function authenticated(ctx: Ctx): UserRec {
  const session = ctx.getSession();
  const user = session ? ctx.db.user(session.user_id) : undefined;
  if (
    !session ||
    !user ||
    !user.is_active ||
    user.token_version !== session.token_version ||
    new Date(session.expires_at) <= ctx.now
  ) {
    throw new LocalApiError(401, "UNAUTHENTICATED", session ? "Invalid or expired session" : "Sign in to continue");
  }
  return user;
}

export function current(ctx: Ctx): UserRec {
  const user = authenticated(ctx);
  if (user.must_change_password) {
    throw new LocalApiError(403, "PASSWORD_CHANGE_REQUIRED", "Change your temporary password to continue");
  }
  return user;
}

export function requireRoles(ctx: Ctx, ...roles: Role[]): UserRec {
  const user = current(ctx);
  if (!roles.includes(user.role)) throw new LocalApiError(403, "FORBIDDEN", "Insufficient permission");
  return user;
}

export const iso = (date: Date) => date.toISOString();

export function audit(
  ctx: Ctx,
  userId: number | null,
  action: string,
  entity: string,
  entityId: string | number | null,
  details: Record<string, unknown> | null = null,
) {
  const { audit_logs } = ctx.db.data;
  audit_logs.push({
    id: ctx.db.nextId(audit_logs),
    user_id: userId,
    action,
    entity,
    entity_id: entityId === null ? null : String(entityId),
    details,
    created_at: iso(ctx.now),
  });
}

export function notify(ctx: Ctx, userIds: Iterable<number>, title: string, message: string, link: string | null = null) {
  const { notifications } = ctx.db.data;
  for (const userId of new Set(userIds)) {
    notifications.push({
      id: ctx.db.nextId(notifications),
      user_id: userId,
      title,
      message,
      link,
      is_read: false,
      created_at: iso(ctx.now),
    });
  }
}

export function userIdsForEmails(ctx: Ctx, emails: Iterable<string>) {
  const wanted = new Set([...emails].map((email) => email.toLowerCase()));
  return ctx.db.data.users.filter((user) => user.is_active && wanted.has(user.email)).map((user) => user.id);
}

export function userIdsWithRoles(ctx: Ctx, ...roles: Role[]) {
  return ctx.db.data.users.filter((user) => user.is_active && roles.includes(user.role)).map((user) => user.id);
}

// --- Serializers: the exact shapes the UI expects (see lib/types.ts). Never include password hashes. ---

export const userRead = (user: UserRec) => ({
  id: user.id,
  email: user.email,
  full_name: user.full_name,
  department: user.department,
  team: user.team,
  role: user.role as UiRole,
  is_active: user.is_active,
  must_change_password: user.must_change_password,
});

export function roomRead(db: Database, room: RoomRec) {
  const facilities = room.facility_ids
    .map((id) => db.data.facilities.find((facility) => facility.id === id))
    .filter((facility): facility is NonNullable<typeof facility> => Boolean(facility));
  return { ...room, facility_ids: facilities.map((facility) => facility.id), facility_names: facilities.map((facility) => facility.name) };
}

export function bookingRead(db: Database, booking: BookingRec): Booking {
  return {
    id: booking.id,
    room_id: booking.room_id,
    title: booking.title,
    description: booking.description,
    attendee_count: booking.attendee_count,
    starts_at: booking.starts_at,
    ends_at: booking.ends_at,
    status: booking.status,
    room_name: db.room(booking.room_id)?.name ?? "",
    organizer_name: db.user(booking.organizer_id)?.full_name ?? "",
    participant_emails: [...booking.participants],
    checked_in_at: booking.checked_in_at,
    series_id: booking.series_id,
    decision_note: booking.decision_note,
  };
}

export const when = (value: string) => formatWhen(new Date(value));
