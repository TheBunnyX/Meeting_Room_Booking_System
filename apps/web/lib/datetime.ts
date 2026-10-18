// Date helpers. Everything the user types or sees is in the browser's local time;
// everything sent to the API is an ISO-8601 instant with an explicit offset.

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** `YYYY-MM-DD` for a local calendar day (month is zero-based, as in Date). */
export function calendarDateKey(year: number, month: number, day: number) {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

export function dateKey(date: Date) {
  return calendarDateKey(date.getFullYear(), date.getMonth(), date.getDate());
}

export function todayKey() {
  return dateKey(new Date());
}

/** The local calendar day an ISO instant falls on. */
export function isoDateKey(value: string) {
  return dateKey(new Date(value));
}

/** Value for an `<input type="datetime-local">` showing an ISO instant in local time. */
export function toLocalInputValue(value: string) {
  const date = new Date(value);
  return `${dateKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Parse a `datetime-local` value (local time, no offset) into an ISO instant, or null if invalid. */
export function localInputToIso(value: string) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(
    new Date(value),
  );
}

/** A clock time such as "9:30 AM". */
export function formatTime(value: string) {
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function formatTimeRange(startsAt: string, endsAt: string) {
  const formatter = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" });
  return `${formatter.format(new Date(startsAt))} – ${formatter.format(new Date(endsAt))}`;
}

/** Cells for a Monday-first month grid: leading blanks as null, then the day numbers. */
export function monthGrid(year: number, month: number): (number | null)[] {
  const leadingBlanks = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return [...Array<null>(leadingBlanks).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)];
}

export function initials(name: string | undefined | null) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return letters.toUpperCase();
}
