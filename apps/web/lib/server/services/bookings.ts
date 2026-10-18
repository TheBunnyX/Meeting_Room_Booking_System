import { randomUUID } from "node:crypto";

import { type Booking, BookingStatus, type Prisma, type Role, type Room, type User } from "@prisma/client";

import { getConfig } from "../config";
import { type Db, db, isOverlapViolation, isUniqueViolation } from "../db";
import { AppError } from "../errors";
import type { BookingWithRelations } from "../serializers";
import { days, formatWhen, hours, localDate, localTime, localTimeSeconds, minutes } from "../time";
import type { BookingInput, BookingUpdate } from "../validation";
import { notify, userIdsForEmails, userIdsWithRoles } from "./notifications";

export const ACTIVE_STATUSES: BookingStatus[] = [BookingStatus.CONFIRMED, BookingStatus.PENDING_APPROVAL];
export const MANAGER_ROLES: Role[] = ["ADMIN", "FACILITY_ADMIN"];
const MAX_DURATION_MS = hours(4);
const MAX_ADVANCE_MS = days(30);
const CHECK_IN_OPENS_BEFORE_MS = minutes(15);
const CHECK_IN_GRACE_MS = minutes(15);
const RECURRENCE_STEP_MS = days(7);
const MAX_SCHEDULE_RANGE_MS = days(62);
const BOOKINGS_LINK = "/bookings";

export const bookingRelations = { room: true, organizer: true, participants: true } satisfies Prisma.BookingInclude;

export const policy = () => ({
  max_duration_hours: MAX_DURATION_MS / 3_600_000,
  max_advance_days: MAX_ADVANCE_MS / 86_400_000,
  check_in_opens_minutes_before: CHECK_IN_OPENS_BEFORE_MS / 60_000,
  check_in_grace_minutes: CHECK_IN_GRACE_MS / 60_000,
  recurring_booking_supported: true,
  timezone: getConfig().facilityTimezone,
});

export async function getBooking(id: number, client: Db = db): Promise<BookingWithRelations> {
  const booking = await client.booking.findUnique({ where: { id }, include: bookingRelations });
  if (!booking) throw new AppError(404, "BOOKING_NOT_FOUND", "Booking not found");
  return booking;
}

function ensureCanManage(booking: Pick<Booking, "organizerId">, user: User) {
  if (booking.organizerId !== user.id && !MANAGER_ROLES.includes(user.role)) {
    throw new AppError(403, "FORBIDDEN", "You are not allowed to manage this booking");
  }
}

async function ensureParticipantsExist(client: Db, participantEmails: string[]) {
  const wanted = [...new Set(participantEmails.map((email) => email.toLowerCase()))];
  if (wanted.length === 0) return;
  const active = await client.user.count({ where: { isActive: true, email: { in: wanted } } });
  if (active !== wanted.length) {
    throw new AppError(422, "UNKNOWN_PARTICIPANT", "All participants must be active users in the system", "participant_emails");
  }
}

function ensureWithinOpeningHours(room: Room, startsAt: Date, endsAt: Date) {
  const inside =
    localDate(startsAt) === localDate(endsAt) &&
    localTime(startsAt) >= room.opensAt &&
    localTimeSeconds(endsAt) <= `${room.closesAt}:00`;
  if (!inside) {
    throw new AppError(
      400,
      "OUTSIDE_OPENING_HOURS",
      `${room.name} is open ${room.opensAt}–${room.closesAt} (${getConfig().facilityTimezone})`,
      "starts_at",
    );
  }
}

async function roomHasConflict(client: Db, roomId: number, startsAt: Date, endsAt: Date, excludeBookingId?: number) {
  const booking = await client.booking.findFirst({
    where: {
      roomId,
      status: { in: ACTIVE_STATUSES },
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      ...(excludeBookingId === undefined ? {} : { id: { not: excludeBookingId } }),
    },
    select: { id: true },
  });
  if (booking) return true;
  const maintenance = await client.maintenance.findFirst({
    where: { roomId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
    select: { id: true },
  });
  return maintenance !== null;
}

const unavailableError = () =>
  new AppError(409, "ROOM_UNAVAILABLE", "Room is already booked or under maintenance during this period", "starts_at");

async function ensureSlotBookable(
  client: Db,
  room: Room,
  startsAt: Date,
  endsAt: Date,
  now: Date,
  excludeBookingId?: number,
) {
  if (startsAt < now) throw new AppError(400, "BOOKING_IN_PAST", "Bookings cannot start in the past", "starts_at");
  if (startsAt.getTime() > now.getTime() + MAX_ADVANCE_MS) {
    throw new AppError(400, "BOOKING_TOO_FAR_AHEAD", "Bookings may be made at most 30 days ahead", "starts_at");
  }
  ensureWithinOpeningHours(room, startsAt, endsAt);
  if (await roomHasConflict(client, room.id, startsAt, endsAt, excludeBookingId)) throw unavailableError();
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

/** Turn a lost race on the overlap constraint into the same 409 as the pre-check. */
async function overlapGuard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isOverlapViolation(error)) throw unavailableError();
    throw error;
  }
}

async function participantIds(client: Db, booking: { participants: { email: string }[] }, excludeUserId?: number) {
  const ids = await userIdsForEmails(client, booking.participants.map((participant) => participant.email));
  return ids.filter((id) => id !== excludeUserId);
}

async function notifyManagersOfRequest(
  client: Db,
  booking: { title: string; startsAt: Date },
  room: Room,
  requester: User,
  count = 1,
) {
  const extra = count > 1 ? ` (weekly, ${count} meetings)` : "";
  const managers = (await userIdsWithRoles(client, ...MANAGER_ROLES)).filter((id) => id !== requester.id);
  await notify(
    client,
    managers,
    "Booking awaiting approval",
    `${requester.fullName} requested ${room.name} for “${booking.title}” on ${formatWhen(booking.startsAt)}${extra}.`,
    "/admin",
  );
}

export async function createBooking(user: User, payload: BookingInput) {
  const now = new Date();
  const room = await db.room.findUnique({ where: { id: payload.room_id } });
  if (!room || !room.isActive) throw new AppError(404, "ROOM_NOT_AVAILABLE", "Room not available", "room_id");
  if (payload.attendee_count > room.capacity) {
    throw new AppError(400, "CAPACITY_EXCEEDED", "Attendee count exceeds room capacity", "attendee_count");
  }
  await ensureParticipantsExist(db, payload.participant_emails);
  const windows = recurringWindows(payload.starts_at, payload.ends_at, payload.recurrence_rule, now);
  for (const [startsAt, endsAt] of windows) await ensureSlotBookable(db, room, startsAt, endsAt, now);
  const status = room.requiresApproval ? BookingStatus.PENDING_APPROVAL : BookingStatus.CONFIRMED;
  const seriesId = windows.length > 1 ? randomUUID().replaceAll("-", "") : null;

  const bookingId = await overlapGuard(() =>
    db.$transaction(async (tx) => {
      const created: Booking[] = [];
      for (const [startsAt, endsAt] of windows) {
        created.push(
          await tx.booking.create({
            data: {
              roomId: room.id,
              organizerId: user.id,
              title: payload.title,
              description: payload.description || null,
              attendeeCount: payload.attendee_count,
              startsAt,
              endsAt,
              status,
              recurrenceRule: payload.recurrence_rule ?? null,
              seriesId,
              participants: { create: payload.participant_emails.map((email) => ({ email })) },
            },
          }),
        );
      }
      const first = created[0];
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: "CREATE",
          entity: "Booking",
          entityId: String(first.id),
          details: { series_count: created.length },
        },
      });
      const repeats = created.length > 1 ? ` It repeats weekly (${created.length} meetings).` : "";
      const invited = await userIdsForEmails(tx, payload.participant_emails);
      await notify(
        tx,
        invited.filter((id) => id !== user.id),
        "You were invited to a meeting",
        `${user.fullName} invited you to “${first.title}” in ${room.name} on ${formatWhen(first.startsAt)}.${repeats}`,
        BOOKINGS_LINK,
      );
      if (status === BookingStatus.PENDING_APPROVAL) await notifyManagersOfRequest(tx, first, room, user, created.length);
      return first.id;
    }),
  );
  return getBooking(bookingId);
}

export async function updateBooking(user: User, bookingId: number, payload: BookingUpdate) {
  const now = new Date();
  const booking = await getBooking(bookingId);
  ensureCanManage(booking, user);
  if (!ACTIVE_STATUSES.includes(booking.status)) {
    throw new AppError(409, "BOOKING_NOT_EDITABLE", "Only upcoming bookings can be edited");
  }
  const room = await db.room.findUnique({ where: { id: payload.room_id ?? booking.roomId } });
  if (!room || !room.isActive) throw new AppError(404, "ROOM_NOT_AVAILABLE", "Room not available", "room_id");
  const startsAt = payload.starts_at ?? booking.startsAt;
  const endsAt = payload.ends_at ?? booking.endsAt;
  if (endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > MAX_DURATION_MS) {
    throw new AppError(400, "INVALID_DURATION", "Invalid booking duration", "ends_at");
  }
  if ((payload.attendee_count ?? booking.attendeeCount) > room.capacity) {
    throw new AppError(400, "CAPACITY_EXCEEDED", "Attendee count exceeds room capacity", "attendee_count");
  }
  const slotChanged =
    room.id !== booking.roomId ||
    startsAt.getTime() !== booking.startsAt.getTime() ||
    endsAt.getTime() !== booking.endsAt.getTime();
  if (slotChanged) {
    if (booking.checkedInAt) throw new AppError(409, "BOOKING_CHECKED_IN", "A checked-in booking cannot be moved");
    await ensureSlotBookable(db, room, startsAt, endsAt, now, booking.id);
  }
  if (payload.participant_emails) await ensureParticipantsExist(db, payload.participant_emails);

  const data: Prisma.BookingUpdateInput = {};
  if (payload.title !== undefined) data.title = payload.title;
  if (payload.description !== undefined) data.description = payload.description || null;
  if (payload.attendee_count !== undefined) data.attendeeCount = payload.attendee_count;
  if (slotChanged) {
    data.room = { connect: { id: room.id } };
    data.startsAt = startsAt;
    data.endsAt = endsAt;
    data.checkInReminderSent = false;
    // Moving a booking is a new request for the slot, so the room's approval rule applies again.
    data.status = room.requiresApproval ? BookingStatus.PENDING_APPROVAL : BookingStatus.CONFIRMED;
  }

  await overlapGuard(() =>
    db.$transaction(async (tx) => {
      const previousEmails = new Set(booking.participants.map((participant) => participant.email));
      let participants = booking.participants.map((participant) => participant.email);
      if (payload.participant_emails) {
        participants = payload.participant_emails;
        await tx.bookingParticipant.deleteMany({
          where: { bookingId: booking.id, email: { notIn: participants } },
        });
        const added = participants.filter((email) => !previousEmails.has(email));
        if (added.length > 0) {
          await tx.bookingParticipant.createMany({ data: added.map((email) => ({ bookingId: booking.id, email })) });
        }
      }
      const updated = await tx.booking.update({ where: { id: booking.id }, data });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: "UPDATE",
          entity: "Booking",
          entityId: String(booking.id),
          details: { slot_changed: slotChanged },
        },
      });
      const where = `“${updated.title}” in ${room.name} on ${formatWhen(startsAt)}`;
      const addedEmails = participants.filter((email) => !previousEmails.has(email));
      const addedIds = (await userIdsForEmails(tx, addedEmails)).filter((id) => id !== user.id);
      await notify(tx, addedIds, "You were invited to a meeting", `${user.fullName} invited you to ${where}.`, BOOKINGS_LINK);
      if (slotChanged) {
        const alreadyTold = new Set(addedIds);
        const recipients = (await participantIds(tx, { participants: participants.map((email) => ({ email })) }, user.id)).filter(
          (id) => !alreadyTold.has(id),
        );
        await notify(
          tx,
          recipients,
          "A meeting was moved",
          `${where} — the time or room was changed by ${user.fullName}.`,
          BOOKINGS_LINK,
        );
        if (updated.status === BookingStatus.PENDING_APPROVAL) await notifyManagersOfRequest(tx, updated, room, user);
      }
    }),
  );
  return getBooking(booking.id);
}

export const listMyBookings = (user: User, limit: number, offset: number) =>
  db.booking.findMany({
    where: { organizerId: user.id },
    include: bookingRelations,
    orderBy: [{ startsAt: "desc" }, { id: "desc" }],
    take: limit,
    skip: offset,
  });

/** Upcoming meetings organised by someone else that the user is a participant of. */
export const listInvited = (user: User) =>
  db.booking.findMany({
    where: {
      participants: { some: { email: user.email } },
      organizerId: { not: user.id },
      status: { in: ACTIVE_STATUSES },
      endsAt: { gt: new Date() },
    },
    include: bookingRelations,
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
  });

export async function listSchedule(startsAt: Date, endsAt: Date) {
  if (endsAt <= startsAt) throw new AppError(400, "INVALID_TIME_RANGE", "End time must be after start time", "ends_at");
  if (endsAt.getTime() - startsAt.getTime() > MAX_SCHEDULE_RANGE_MS) {
    throw new AppError(400, "RANGE_TOO_LARGE", "The schedule range cannot exceed 62 days", "ends_at");
  }
  return db.booking.findMany({
    where: { status: { in: ACTIVE_STATUSES }, endsAt: { gt: startsAt }, startsAt: { lt: endsAt } },
    include: { room: true, organizer: true },
    orderBy: [{ startsAt: "asc" }, { roomId: "asc" }],
  });
}

export const listPending = () =>
  db.booking.findMany({
    where: { status: BookingStatus.PENDING_APPROVAL, endsAt: { gt: new Date() } },
    include: bookingRelations,
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
  });

async function notifyCancelled(
  client: Db,
  actor: User,
  booking: BookingWithRelations,
  seriesCount = 1,
) {
  let what = `“${booking.title}” in ${booking.room.name} on ${formatWhen(booking.startsAt)}`;
  if (seriesCount > 1) what = `The weekly series ${what} (${seriesCount} meetings)`;
  const recipients = await participantIds(client, booking, actor.id);
  if (booking.organizerId !== actor.id) recipients.push(booking.organizerId);
  await notify(client, recipients, "A meeting was cancelled", `${what} was cancelled by ${actor.fullName}.`, BOOKINGS_LINK);
}

export async function cancelBooking(user: User, bookingId: number) {
  const booking = await getBooking(bookingId);
  ensureCanManage(booking, user);
  if (booking.status === BookingStatus.CANCELLED) return booking;
  if (!ACTIVE_STATUSES.includes(booking.status)) {
    throw new AppError(409, "BOOKING_NOT_CANCELLABLE", "Only upcoming bookings can be cancelled");
  }
  await db.$transaction(async (tx) => {
    await tx.booking.update({ where: { id: booking.id }, data: { status: BookingStatus.CANCELLED } });
    await tx.auditLog.create({
      data: { userId: user.id, action: "CANCEL", entity: "Booking", entityId: String(booking.id) },
    });
    await notifyCancelled(tx, user, booking);
  });
  return getBooking(booking.id);
}

/** Cancel every occurrence of the booking's series that has not finished yet. */
export async function cancelSeries(user: User, bookingId: number) {
  const booking = await getBooking(bookingId);
  ensureCanManage(booking, user);
  if (!booking.seriesId) throw new AppError(409, "NOT_A_SERIES", "This booking is not part of a recurring series");
  const remaining = await db.booking.findMany({
    where: { seriesId: booking.seriesId, status: { in: ACTIVE_STATUSES }, endsAt: { gt: new Date() } },
    include: bookingRelations,
    orderBy: { startsAt: "asc" },
  });
  if (remaining.length === 0) return 0;
  await db.$transaction(async (tx) => {
    await tx.booking.updateMany({
      where: { id: { in: remaining.map((item) => item.id) } },
      data: { status: BookingStatus.CANCELLED },
    });
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "CANCEL_SERIES",
        entity: "Booking",
        entityId: String(booking.id),
        details: { cancelled: remaining.length },
      },
    });
    await notifyCancelled(tx, user, remaining[0], remaining.length);
  });
  return remaining.length;
}

export async function decideBooking(actor: User, bookingId: number, approve: boolean, reason?: string) {
  const booking = await getBooking(bookingId);
  if (booking.status !== BookingStatus.PENDING_APPROVAL) {
    throw new AppError(409, "BOOKING_NOT_PENDING", "This booking is not waiting for approval");
  }
  if (approve && booking.endsAt <= new Date()) {
    throw new AppError(409, "BOOKING_EXPIRED", "This booking request has already ended");
  }
  await db.$transaction(async (tx) => {
    // The status guard keeps two managers from deciding the same request twice.
    const claimed = await tx.booking.updateMany({
      where: { id: booking.id, status: BookingStatus.PENDING_APPROVAL },
      data: {
        status: approve ? BookingStatus.CONFIRMED : BookingStatus.REJECTED,
        decisionNote: approve ? null : (reason ?? null),
      },
    });
    if (claimed.count === 0) throw new AppError(409, "BOOKING_NOT_PENDING", "This booking is not waiting for approval");
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: approve ? "APPROVE" : "REJECT",
        entity: "Booking",
        entityId: String(booking.id),
        details: approve ? undefined : { reason },
      },
    });
    const what = `“${booking.title}” in ${booking.room.name} on ${formatWhen(booking.startsAt)}`;
    if (approve) {
      await notify(tx, [booking.organizerId], "Booking approved", `${what} was approved.`, BOOKINGS_LINK);
    } else {
      await notify(tx, [booking.organizerId], "Booking rejected", `${what} was rejected. Reason: ${reason}`, BOOKINGS_LINK);
      await notify(
        tx,
        await participantIds(tx, booking, booking.organizerId),
        "A meeting was cancelled",
        `${what} will not take place: the room request was rejected.`,
        BOOKINGS_LINK,
      );
    }
  });
  return getBooking(booking.id);
}

function checkInWindowOpen(booking: Pick<Booking, "startsAt" | "endsAt">, now: Date) {
  const start = booking.startsAt.getTime();
  return (
    start - CHECK_IN_OPENS_BEFORE_MS <= now.getTime() && now.getTime() <= start + CHECK_IN_GRACE_MS && now < booking.endsAt
  );
}

/** Store the check-in. Returns false when a concurrent request recorded it first. */
async function recordCheckIn(user: User, booking: Booking, now: Date, method: string) {
  try {
    await db.$transaction([
      db.booking.update({ where: { id: booking.id }, data: { checkedInAt: now } }),
      db.checkIn.create({ data: { bookingId: booking.id, checkedInBy: user.id, method } }),
    ]);
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

/** Check in from the booking list. Returns the booking and whether this call created the check-in. */
export async function checkIn(user: User, bookingId: number) {
  const now = new Date();
  const booking = await getBooking(bookingId);
  ensureCanManage(booking, user);
  if (booking.checkedInAt) return { booking, created: false };
  if (booking.status !== BookingStatus.CONFIRMED) {
    throw new AppError(409, "BOOKING_NOT_CONFIRMED", "Only confirmed bookings can be checked in");
  }
  if (now.getTime() < booking.startsAt.getTime() - CHECK_IN_OPENS_BEFORE_MS) {
    throw new AppError(
      400,
      "CHECK_IN_NOT_OPEN",
      `Check-in opens ${CHECK_IN_OPENS_BEFORE_MS / 60_000} minutes before the booking starts`,
    );
  }
  if (!checkInWindowOpen(booking, now)) {
    throw new AppError(409, "CHECK_IN_CLOSED", "The check-in window for this booking has closed");
  }
  const created = await recordCheckIn(user, booking, now, "WEB");
  return { booking: await getBooking(booking.id), created };
}

/** Check in by scanning the room's QR code: finds the caller's own booking that is due now. */
export async function checkInAtRoom(user: User, roomId: number) {
  const now = new Date();
  if (!(await db.room.findUnique({ where: { id: roomId }, select: { id: true } }))) {
    throw new AppError(404, "ROOM_NOT_FOUND", "Room not found");
  }
  const candidates = await db.booking.findMany({
    where: {
      roomId,
      organizerId: user.id,
      status: BookingStatus.CONFIRMED,
      startsAt: { lte: new Date(now.getTime() + CHECK_IN_OPENS_BEFORE_MS) },
      endsAt: { gt: now },
    },
    include: bookingRelations,
    orderBy: { startsAt: "asc" },
  });
  for (const booking of candidates) {
    if (booking.checkedInAt) return { booking, created: false };
    if (checkInWindowOpen(booking, now)) {
      const created = await recordCheckIn(user, booking, now, "QR");
      return { booking: await getBooking(booking.id), created };
    }
  }
  throw new AppError(404, "NO_BOOKING_TO_CHECK_IN", "You have no booking in this room that can be checked in right now");
}

async function sendCheckInReminders(now: Date) {
  const due = await db.booking.findMany({
    where: {
      status: BookingStatus.CONFIRMED,
      checkedInAt: null,
      checkInReminderSent: false,
      startsAt: { lte: new Date(now.getTime() + CHECK_IN_OPENS_BEFORE_MS), gt: new Date(now.getTime() - CHECK_IN_GRACE_MS) },
    },
    include: { room: true },
  });
  let sent = 0;
  for (const booking of due) {
    await db.$transaction(async (tx) => {
      // Claiming the flag first means overlapping sweeps never send the same reminder twice.
      const claimed = await tx.booking.updateMany({
        where: { id: booking.id, checkInReminderSent: false },
        data: { checkInReminderSent: true },
      });
      if (claimed.count === 0) return;
      sent += 1;
      await notify(
        tx,
        [booking.organizerId],
        "Check-in is open",
        `“${booking.title}” in ${booking.room.name} starts at ${formatWhen(booking.startsAt)}. Check in to keep the room.`,
        BOOKINGS_LINK,
      );
    });
  }
  return sent;
}

/**
 * Remind organisers to check in, mark missed bookings as no-shows and finished ones as completed.
 * Returns the number of no-shows, completed bookings and reminders sent.
 */
export async function sweepStatuses() {
  const now = new Date();
  const reminders = await sendCheckInReminders(now);
  const missed = await db.booking.findMany({
    where: {
      status: BookingStatus.CONFIRMED,
      checkedInAt: null,
      startsAt: { lte: new Date(now.getTime() - CHECK_IN_GRACE_MS) },
    },
    include: { room: true },
  });
  let noShows = 0;
  for (const booking of missed) {
    await db.$transaction(async (tx) => {
      const claimed = await tx.booking.updateMany({
        where: { id: booking.id, status: BookingStatus.CONFIRMED, checkedInAt: null },
        data: { status: BookingStatus.NO_SHOW },
      });
      if (claimed.count === 0) return;
      noShows += 1;
      await notify(
        tx,
        [booking.organizerId],
        "Booking marked as no-show",
        `“${booking.title}” in ${booking.room.name} on ${formatWhen(booking.startsAt)} was not checked in, so the room was released.`,
        BOOKINGS_LINK,
      );
    });
  }
  const completed = await db.booking.updateMany({
    where: { status: BookingStatus.CONFIRMED, checkedInAt: { not: null }, endsAt: { lte: now } },
    data: { status: BookingStatus.COMPLETED },
  });
  return { noShows, completed: completed.count, reminders };
}
