import type { BookingRec, RoomRec, UserRec } from "../database";
import { LocalApiError } from "../errors";
import { FACILITY_TIMEZONE, formatWhen, localDate, localTime, localTimeSeconds } from "../time";
import type { BookingInput, BookingUpdate } from "../validation";
import {
  ACTIVE_STATUSES,
  MANAGER_ROLES,
  type Ctx,
  audit,
  authenticated,
  bookingRead,
  current,
  iso,
  notify,
  requireRoles,
  userIdsForEmails,
  userIdsWithRoles,
  when,
} from "./shared";

const MINUTE = 60_000;
const DAY = 86_400_000;
const MAX_DURATION_MS = 4 * 60 * MINUTE;
const MAX_ADVANCE_MS = 30 * DAY;
const CHECK_IN_OPENS_BEFORE_MS = 15 * MINUTE;
const CHECK_IN_GRACE_MS = 15 * MINUTE;
const RECURRENCE_STEP_MS = 7 * DAY;
const MAX_SCHEDULE_RANGE_MS = 62 * DAY;
const BOOKINGS_LINK = "/bookings";

export const policy = () => ({
  max_duration_hours: MAX_DURATION_MS / (60 * MINUTE),
  max_advance_days: MAX_ADVANCE_MS / DAY,
  check_in_opens_minutes_before: CHECK_IN_OPENS_BEFORE_MS / MINUTE,
  check_in_grace_minutes: CHECK_IN_GRACE_MS / MINUTE,
  recurring_booking_supported: true,
  timezone: FACILITY_TIMEZONE,
});

function getBooking(ctx: Ctx, id: number): BookingRec {
  const booking = ctx.db.booking(id);
  if (!booking) throw new LocalApiError(404, "BOOKING_NOT_FOUND", "Booking not found");
  return booking;
}

function ensureCanManage(booking: BookingRec, user: UserRec) {
  if (booking.organizer_id !== user.id && !MANAGER_ROLES.includes(user.role)) {
    throw new LocalApiError(403, "FORBIDDEN", "You are not allowed to manage this booking");
  }
}

function ensureParticipantsExist(ctx: Ctx, emails: string[]) {
  const wanted = [...new Set(emails.map((email) => email.toLowerCase()))];
  const active = ctx.db.data.users.filter((user) => user.is_active && wanted.includes(user.email));
  if (active.length !== wanted.length) {
    throw new LocalApiError(422, "UNKNOWN_PARTICIPANT", "All participants must be active users in the system", "participant_emails");
  }
}

function ensureWithinOpeningHours(room: RoomRec, startsAt: Date, endsAt: Date) {
  const inside =
    localDate(startsAt) === localDate(endsAt) &&
    localTime(startsAt) >= room.opens_at &&
    localTimeSeconds(endsAt) <= `${room.closes_at}:00`;
  if (!inside) {
    throw new LocalApiError(
      400,
      "OUTSIDE_OPENING_HOURS",
      `${room.name} is open ${room.opens_at}–${room.closes_at} (${FACILITY_TIMEZONE})`,
      "starts_at",
    );
  }
}

const unavailable = () =>
  new LocalApiError(409, "ROOM_UNAVAILABLE", "Room is already booked or under maintenance during this period", "starts_at");

function roomHasConflict(ctx: Ctx, roomId: number, startsAt: Date, endsAt: Date, excludeBookingId?: number) {
  const clashes = (from: string, to: string) => new Date(from) < endsAt && new Date(to) > startsAt;
  return (
    ctx.db.data.bookings.some(
      (booking) =>
        booking.room_id === roomId &&
        booking.id !== excludeBookingId &&
        ACTIVE_STATUSES.includes(booking.status) &&
        clashes(booking.starts_at, booking.ends_at),
    ) || ctx.db.data.maintenance.some((item) => item.room_id === roomId && clashes(item.starts_at, item.ends_at))
  );
}

function ensureSlotBookable(ctx: Ctx, room: RoomRec, startsAt: Date, endsAt: Date, excludeBookingId?: number) {
  if (startsAt < ctx.now) throw new LocalApiError(400, "BOOKING_IN_PAST", "Bookings cannot start in the past", "starts_at");
  if (startsAt.getTime() > ctx.now.getTime() + MAX_ADVANCE_MS) {
    throw new LocalApiError(400, "BOOKING_TOO_FAR_AHEAD", "Bookings may be made at most 30 days ahead", "starts_at");
  }
  ensureWithinOpeningHours(room, startsAt, endsAt);
  if (roomHasConflict(ctx, room.id, startsAt, endsAt, excludeBookingId)) throw unavailable();
}

/** Weekly occurrences, starting with the requested one, that fit the advance-booking policy. */
export function recurringWindows(startsAt: Date, endsAt: Date, recurrenceRule: string | null | undefined, now: Date) {
  const windows: Array<[Date, Date]> = [[startsAt, endsAt]];
  if (!recurrenceRule) return windows;
  const limit = now.getTime() + MAX_ADVANCE_MS;
  for (;;) {
    const [previousStart, previousEnd] = windows[windows.length - 1];
    if (previousStart.getTime() + RECURRENCE_STEP_MS > limit) break;
    windows.push([new Date(previousStart.getTime() + RECURRENCE_STEP_MS), new Date(previousEnd.getTime() + RECURRENCE_STEP_MS)]);
  }
  return windows;
}

const participantIds = (ctx: Ctx, booking: { participants: string[] }, excludeUserId?: number) =>
  userIdsForEmails(ctx, booking.participants).filter((id) => id !== excludeUserId);

function notifyManagersOfRequest(ctx: Ctx, booking: BookingRec, room: RoomRec, requester: UserRec, count = 1) {
  const extra = count > 1 ? ` (weekly, ${count} meetings)` : "";
  notify(
    ctx,
    userIdsWithRoles(ctx, ...MANAGER_ROLES).filter((id) => id !== requester.id),
    "Booking awaiting approval",
    `${requester.full_name} requested ${room.name} for “${booking.title}” on ${when(booking.starts_at)}${extra}.`,
    "/admin",
  );
}

export function createBooking(ctx: Ctx, payload: BookingInput) {
  const user = current(ctx);
  const room = ctx.db.room(payload.room_id);
  if (!room || !room.is_active) throw new LocalApiError(404, "ROOM_NOT_AVAILABLE", "Room not available", "room_id");
  if (payload.attendee_count > room.capacity) {
    throw new LocalApiError(400, "CAPACITY_EXCEEDED", "Attendee count exceeds room capacity", "attendee_count");
  }
  ensureParticipantsExist(ctx, payload.participant_emails);
  const windows = recurringWindows(payload.starts_at, payload.ends_at, payload.recurrence_rule, ctx.now);
  for (const [startsAt, endsAt] of windows) ensureSlotBookable(ctx, room, startsAt, endsAt);

  const status = room.requires_approval ? "PENDING_APPROVAL" : "CONFIRMED";
  const seriesId = windows.length > 1 ? crypto.randomUUID().replaceAll("-", "") : null;
  const created = windows.map(([startsAt, endsAt]) => {
    const booking: BookingRec = {
      id: 0,
      room_id: room.id,
      organizer_id: user.id,
      title: payload.title,
      description: payload.description || null,
      attendee_count: payload.attendee_count,
      starts_at: iso(startsAt),
      ends_at: iso(endsAt),
      status,
      recurrence_rule: payload.recurrence_rule ?? null,
      checked_in_at: null,
      series_id: seriesId,
      decision_note: null,
      check_in_reminder_sent: false,
      participants: [...payload.participant_emails],
    };
    booking.id = ctx.db.nextId(ctx.db.data.bookings);
    ctx.db.data.bookings.push(booking);
    return booking;
  });
  const first = created[0];
  audit(ctx, user.id, "CREATE", "Booking", first.id, { series_count: created.length });
  const repeats = created.length > 1 ? ` It repeats weekly (${created.length} meetings).` : "";
  notify(
    ctx,
    userIdsForEmails(ctx, first.participants).filter((id) => id !== user.id),
    "You were invited to a meeting",
    `${user.full_name} invited you to “${first.title}” in ${room.name} on ${when(first.starts_at)}.${repeats}`,
    BOOKINGS_LINK,
  );
  if (status === "PENDING_APPROVAL") notifyManagersOfRequest(ctx, first, room, user, created.length);
  return bookingRead(ctx.db, first);
}

export function updateBooking(ctx: Ctx, bookingId: number, payload: BookingUpdate) {
  const user = current(ctx);
  const booking = getBooking(ctx, bookingId);
  ensureCanManage(booking, user);
  if (!ACTIVE_STATUSES.includes(booking.status)) {
    throw new LocalApiError(409, "BOOKING_NOT_EDITABLE", "Only upcoming bookings can be edited");
  }
  const room = ctx.db.room(payload.room_id ?? booking.room_id);
  if (!room || !room.is_active) throw new LocalApiError(404, "ROOM_NOT_AVAILABLE", "Room not available", "room_id");
  const startsAt = payload.starts_at ?? new Date(booking.starts_at);
  const endsAt = payload.ends_at ?? new Date(booking.ends_at);
  if (endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > MAX_DURATION_MS) {
    throw new LocalApiError(400, "INVALID_DURATION", "Invalid booking duration", "ends_at");
  }
  if ((payload.attendee_count ?? booking.attendee_count) > room.capacity) {
    throw new LocalApiError(400, "CAPACITY_EXCEEDED", "Attendee count exceeds room capacity", "attendee_count");
  }
  const slotChanged =
    room.id !== booking.room_id ||
    startsAt.getTime() !== new Date(booking.starts_at).getTime() ||
    endsAt.getTime() !== new Date(booking.ends_at).getTime();
  if (slotChanged) {
    if (booking.checked_in_at) throw new LocalApiError(409, "BOOKING_CHECKED_IN", "A checked-in booking cannot be moved");
    ensureSlotBookable(ctx, room, startsAt, endsAt, booking.id);
  }
  if (payload.participant_emails) ensureParticipantsExist(ctx, payload.participant_emails);

  if (payload.title !== undefined) booking.title = payload.title;
  if (payload.description !== undefined) booking.description = payload.description || null;
  if (payload.attendee_count !== undefined) booking.attendee_count = payload.attendee_count;
  if (slotChanged) {
    booking.room_id = room.id;
    booking.starts_at = iso(startsAt);
    booking.ends_at = iso(endsAt);
    booking.check_in_reminder_sent = false;
    // Moving a booking is a new request for the slot, so the room's approval rule applies again.
    booking.status = room.requires_approval ? "PENDING_APPROVAL" : "CONFIRMED";
  }
  const previous = new Set(booking.participants);
  if (payload.participant_emails) booking.participants = [...payload.participant_emails];
  audit(ctx, user.id, "UPDATE", "Booking", booking.id, { slot_changed: slotChanged });

  const where = `“${booking.title}” in ${room.name} on ${formatWhen(startsAt)}`;
  const addedIds = userIdsForEmails(ctx, booking.participants.filter((email) => !previous.has(email))).filter((id) => id !== user.id);
  notify(ctx, addedIds, "You were invited to a meeting", `${user.full_name} invited you to ${where}.`, BOOKINGS_LINK);
  if (slotChanged) {
    const alreadyTold = new Set(addedIds);
    notify(
      ctx,
      participantIds(ctx, booking, user.id).filter((id) => !alreadyTold.has(id)),
      "A meeting was moved",
      `${where} — the time or room was changed by ${user.full_name}.`,
      BOOKINGS_LINK,
    );
    if (booking.status === "PENDING_APPROVAL") notifyManagersOfRequest(ctx, booking, room, user);
  }
  return bookingRead(ctx.db, booking);
}

export function listMyBookings(ctx: Ctx, limit: number, offset: number) {
  const user = current(ctx);
  return ctx.db.data.bookings
    .filter((booking) => booking.organizer_id === user.id)
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at) || b.id - a.id)
    .slice(offset, offset + limit)
    .map((booking) => bookingRead(ctx.db, booking));
}

/** Upcoming meetings organised by someone else that the user is a participant of. */
export function listInvited(ctx: Ctx) {
  const user = current(ctx);
  return ctx.db.data.bookings
    .filter(
      (booking) =>
        booking.participants.includes(user.email) &&
        booking.organizer_id !== user.id &&
        ACTIVE_STATUSES.includes(booking.status) &&
        new Date(booking.ends_at) > ctx.now,
    )
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.id - b.id)
    .map((booking) => bookingRead(ctx.db, booking));
}

export function listSchedule(ctx: Ctx, query: { starts_at: Date; ends_at: Date }) {
  current(ctx);
  if (query.ends_at <= query.starts_at) {
    throw new LocalApiError(400, "INVALID_TIME_RANGE", "End time must be after start time", "ends_at");
  }
  if (query.ends_at.getTime() - query.starts_at.getTime() > MAX_SCHEDULE_RANGE_MS) {
    throw new LocalApiError(400, "RANGE_TOO_LARGE", "The schedule range cannot exceed 62 days", "ends_at");
  }
  return ctx.db.data.bookings
    .filter(
      (booking) =>
        ACTIVE_STATUSES.includes(booking.status) && new Date(booking.ends_at) > query.starts_at && new Date(booking.starts_at) < query.ends_at,
    )
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.room_id - b.room_id)
    .map((booking) => {
      const { id, room_id, title, starts_at, ends_at, status, room_name, organizer_name } = bookingRead(ctx.db, booking);
      return { id, room_id, title, starts_at, ends_at, status, room_name, organizer_name };
    });
}

export function listPending(ctx: Ctx) {
  requireRoles(ctx, "ADMIN", "FACILITY_ADMIN");
  return ctx.db.data.bookings
    .filter((booking) => booking.status === "PENDING_APPROVAL" && new Date(booking.ends_at) > ctx.now)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.id - b.id)
    .map((booking) => bookingRead(ctx.db, booking));
}

function notifyCancelled(ctx: Ctx, actor: UserRec, booking: BookingRec, seriesCount = 1) {
  const room = ctx.db.room(booking.room_id);
  let what = `“${booking.title}” in ${room?.name ?? ""} on ${when(booking.starts_at)}`;
  if (seriesCount > 1) what = `The weekly series ${what} (${seriesCount} meetings)`;
  const recipients = participantIds(ctx, booking, actor.id);
  if (booking.organizer_id !== actor.id) recipients.push(booking.organizer_id);
  notify(ctx, recipients, "A meeting was cancelled", `${what} was cancelled by ${actor.full_name}.`, BOOKINGS_LINK);
}

export function cancelBooking(ctx: Ctx, bookingId: number) {
  const user = current(ctx);
  const booking = getBooking(ctx, bookingId);
  ensureCanManage(booking, user);
  if (booking.status === "CANCELLED") return bookingRead(ctx.db, booking);
  if (!ACTIVE_STATUSES.includes(booking.status)) {
    throw new LocalApiError(409, "BOOKING_NOT_CANCELLABLE", "Only upcoming bookings can be cancelled");
  }
  booking.status = "CANCELLED";
  audit(ctx, user.id, "CANCEL", "Booking", booking.id);
  notifyCancelled(ctx, user, booking);
  return bookingRead(ctx.db, booking);
}

/** Cancel every occurrence of the booking's series that has not finished yet. */
export function cancelSeries(ctx: Ctx, bookingId: number) {
  const user = current(ctx);
  const booking = getBooking(ctx, bookingId);
  ensureCanManage(booking, user);
  if (!booking.series_id) throw new LocalApiError(409, "NOT_A_SERIES", "This booking is not part of a recurring series");
  const remaining = ctx.db.data.bookings
    .filter((item) => item.series_id === booking.series_id && ACTIVE_STATUSES.includes(item.status) && new Date(item.ends_at) > ctx.now)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  if (remaining.length === 0) return { cancelled: 0 };
  for (const item of remaining) item.status = "CANCELLED";
  audit(ctx, user.id, "CANCEL_SERIES", "Booking", booking.id, { cancelled: remaining.length });
  notifyCancelled(ctx, user, remaining[0], remaining.length);
  return { cancelled: remaining.length };
}

export function decideBooking(ctx: Ctx, bookingId: number, approve: boolean, reason?: string) {
  const actor = requireRoles(ctx, "ADMIN", "FACILITY_ADMIN");
  const booking = getBooking(ctx, bookingId);
  if (booking.status !== "PENDING_APPROVAL") {
    throw new LocalApiError(409, "BOOKING_NOT_PENDING", "This booking is not waiting for approval");
  }
  if (approve && new Date(booking.ends_at) <= ctx.now) {
    throw new LocalApiError(409, "BOOKING_EXPIRED", "This booking request has already ended");
  }
  booking.status = approve ? "CONFIRMED" : "REJECTED";
  booking.decision_note = approve ? null : (reason ?? null);
  audit(ctx, actor.id, approve ? "APPROVE" : "REJECT", "Booking", booking.id, approve ? null : { reason: reason ?? null });
  const what = `“${booking.title}” in ${ctx.db.room(booking.room_id)?.name ?? ""} on ${when(booking.starts_at)}`;
  if (approve) {
    notify(ctx, [booking.organizer_id], "Booking approved", `${what} was approved.`, BOOKINGS_LINK);
  } else {
    notify(ctx, [booking.organizer_id], "Booking rejected", `${what} was rejected. Reason: ${reason}`, BOOKINGS_LINK);
    notify(
      ctx,
      participantIds(ctx, booking, booking.organizer_id),
      "A meeting was cancelled",
      `${what} will not take place: the room request was rejected.`,
      BOOKINGS_LINK,
    );
  }
  return bookingRead(ctx.db, booking);
}

function checkInWindowOpen(booking: BookingRec, now: Date) {
  const start = new Date(booking.starts_at).getTime();
  return start - CHECK_IN_OPENS_BEFORE_MS <= now.getTime() && now.getTime() <= start + CHECK_IN_GRACE_MS && now < new Date(booking.ends_at);
}

function recordCheckIn(ctx: Ctx, user: UserRec, booking: BookingRec, method: string) {
  booking.checked_in_at = iso(ctx.now);
  ctx.db.data.check_ins.push({
    id: ctx.db.nextId(ctx.db.data.check_ins),
    booking_id: booking.id,
    checked_in_by: user.id,
    checked_in_at: booking.checked_in_at,
    method,
  });
}

function checkInResult(ctx: Ctx, booking: BookingRec, created: boolean) {
  return {
    message: created ? "Check-in successful" : "Already checked in",
    checked_in_at: booking.checked_in_at as string,
    booking_id: booking.id,
    title: booking.title,
    room_name: ctx.db.room(booking.room_id)?.name ?? "",
  };
}

/** Check in from the booking list. */
export function checkIn(ctx: Ctx, bookingId: number) {
  const user = current(ctx);
  const booking = getBooking(ctx, bookingId);
  ensureCanManage(booking, user);
  if (booking.checked_in_at) return checkInResult(ctx, booking, false);
  if (booking.status !== "CONFIRMED") {
    throw new LocalApiError(409, "BOOKING_NOT_CONFIRMED", "Only confirmed bookings can be checked in");
  }
  if (ctx.now.getTime() < new Date(booking.starts_at).getTime() - CHECK_IN_OPENS_BEFORE_MS) {
    throw new LocalApiError(400, "CHECK_IN_NOT_OPEN", `Check-in opens ${CHECK_IN_OPENS_BEFORE_MS / MINUTE} minutes before the booking starts`);
  }
  if (!checkInWindowOpen(booking, ctx.now)) {
    throw new LocalApiError(409, "CHECK_IN_CLOSED", "The check-in window for this booking has closed");
  }
  recordCheckIn(ctx, user, booking, "WEB");
  return checkInResult(ctx, booking, true);
}

/** Check in by scanning the room's QR code: finds the caller's own booking that is due now. */
export function checkInAtRoom(ctx: Ctx, roomId: number) {
  const user = current(ctx);
  if (!ctx.db.room(roomId)) throw new LocalApiError(404, "ROOM_NOT_FOUND", "Room not found");
  const candidates = ctx.db.data.bookings
    .filter(
      (booking) =>
        booking.room_id === roomId &&
        booking.organizer_id === user.id &&
        booking.status === "CONFIRMED" &&
        new Date(booking.starts_at).getTime() <= ctx.now.getTime() + CHECK_IN_OPENS_BEFORE_MS &&
        new Date(booking.ends_at) > ctx.now,
    )
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  for (const booking of candidates) {
    if (booking.checked_in_at) return checkInResult(ctx, booking, false);
    if (checkInWindowOpen(booking, ctx.now)) {
      recordCheckIn(ctx, user, booking, "QR");
      return checkInResult(ctx, booking, true);
    }
  }
  throw new LocalApiError(404, "NO_BOOKING_TO_CHECK_IN", "You have no booking in this room that can be checked in right now");
}

/**
 * Remind organisers to check in, mark missed bookings as no-shows and finished ones as completed.
 * There is no server to run this on a schedule, so the router runs it before every request.
 */
export function sweepStatuses(ctx: Ctx) {
  let noShows = 0;
  let completed = 0;
  let reminders = 0;
  const now = ctx.now.getTime();
  for (const booking of ctx.db.data.bookings) {
    if (booking.status !== "CONFIRMED") continue;
    const start = new Date(booking.starts_at).getTime();
    const roomName = ctx.db.room(booking.room_id)?.name ?? "";
    if (!booking.checked_in_at && !booking.check_in_reminder_sent && start <= now + CHECK_IN_OPENS_BEFORE_MS && start > now - CHECK_IN_GRACE_MS) {
      booking.check_in_reminder_sent = true;
      reminders += 1;
      notify(
        ctx,
        [booking.organizer_id],
        "Check-in is open",
        `“${booking.title}” in ${roomName} starts at ${when(booking.starts_at)}. Check in to keep the room.`,
        BOOKINGS_LINK,
      );
    }
    if (!booking.checked_in_at && start <= now - CHECK_IN_GRACE_MS) {
      booking.status = "NO_SHOW";
      noShows += 1;
      notify(
        ctx,
        [booking.organizer_id],
        "Booking marked as no-show",
        `“${booking.title}” in ${roomName} on ${when(booking.starts_at)} was not checked in, so the room was released.`,
        BOOKINGS_LINK,
      );
    } else if (booking.checked_in_at && new Date(booking.ends_at).getTime() <= now) {
      booking.status = "COMPLETED";
      completed += 1;
    }
  }
  return { noShows, completed, reminders };
}

export function runSweep(ctx: Ctx) {
  authenticated(ctx);
  requireRoles(ctx, "ADMIN", "FACILITY_ADMIN");
  const { noShows, completed, reminders } = sweepStatuses(ctx);
  return { marked_no_show: noShows, marked_completed: completed, reminders_sent: reminders };
}
