// Geometry for the per-room day view: which hours to show and where a block sits on the track.

export type TimelineWindow = { startHour: number; endHour: number };

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_WINDOW: TimelineWindow = { startHour: 8, endHour: 18 };

function toHours(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours + (minutes || 0) / 60;
}

/** The span of hours covering every room's opening hours, rounded out to whole hours. */
export function timelineWindow(rooms: { opens_at: string; closes_at: string }[]): TimelineWindow {
  if (!rooms.length) return DEFAULT_WINDOW;
  const startHour = Math.floor(Math.min(...rooms.map((room) => toHours(room.opens_at))));
  const endHour = Math.ceil(Math.max(...rooms.map((room) => toHours(room.closes_at))));
  return endHour > startHour ? { startHour, endHour } : DEFAULT_WINDOW;
}

export function hourSlots(window: TimelineWindow) {
  return Array.from({ length: window.endHour - window.startHour }, (_, index) => window.startHour + index);
}

/** Local midnight at the start of a `YYYY-MM-DD` day. */
export function dayStart(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** `HH:00` for an hour of the day. */
export function hourLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

/**
 * Position of a block on the track as percentages, clipped to the visible window.
 * Returns null when the block lies entirely outside it.
 */
export function blockPosition(startsAt: string, endsAt: string, dayStartMs: number, window: TimelineWindow) {
  const windowStart = dayStartMs + window.startHour * HOUR_MS;
  const windowEnd = dayStartMs + window.endHour * HOUR_MS;
  const start = Math.max(new Date(startsAt).getTime(), windowStart);
  const end = Math.min(new Date(endsAt).getTime(), windowEnd);
  if (end <= start) return null;
  const span = windowEnd - windowStart;
  return { left: ((start - windowStart) / span) * 100, width: ((end - start) / span) * 100 };
}

/** Whether a block overlaps the hour starting at `hour` on the given day. */
export function overlapsHour(startsAt: string, endsAt: string, dayStartMs: number, hour: number) {
  const hourStart = dayStartMs + hour * HOUR_MS;
  return new Date(startsAt).getTime() < hourStart + HOUR_MS && new Date(endsAt).getTime() > hourStart;
}

/** Whether a room is open for the whole hour starting at `hour`. */
export function isOpenDuring(room: { opens_at: string; closes_at: string }, hour: number) {
  return hour >= toHours(room.opens_at) && hour + 1 <= toHours(room.closes_at);
}
