/** Room opening hours and "today" are wall-clock times in this timezone. */
export const FACILITY_TIMEZONE = process.env.NEXT_PUBLIC_FACILITY_TIMEZONE || "Asia/Bangkok";

type Parts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
  monthName: string;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string, options: Intl.DateTimeFormatOptions) {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let found = formatters.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat("en-GB", { timeZone, ...options });
    formatters.set(key, found);
  }
  return found;
}

export function zonedParts(date: Date, timeZone = FACILITY_TIMEZONE): Parts {
  const map: Record<string, string> = {};
  const full = formatter(timeZone, {
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  for (const part of full.formatToParts(date)) map[part.type] = part.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: map.weekday,
    monthName: formatter(timeZone, { month: "short" }).format(date),
  };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Calendar date in the facility timezone, e.g. "2026-10-15". */
export function localDate(date: Date) {
  const p = zonedParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "HH:MM" wall-clock time in the facility timezone. */
export function localTime(date: Date) {
  const p = zonedParts(date);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "HH:MM:SS" wall-clock time in the facility timezone. */
export function localTimeSeconds(date: Date) {
  const p = zonedParts(date);
  return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** Offset of the facility timezone from UTC at the given instant, in milliseconds. */
export function offsetMs(date: Date) {
  const p = zonedParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Midnight at the start of the facility-timezone day that contains `date`. */
export function startOfLocalDay(date: Date) {
  const p = zonedParts(date);
  const guess = Date.UTC(p.year, p.month - 1, p.day);
  let result = guess - offsetMs(new Date(guess));
  result = guess - offsetMs(new Date(result));
  return new Date(result);
}

/** A booking time as people at the facility read it, e.g. "Mon 12 Oct, 10:00". */
export function formatWhen(date: Date) {
  const p = zonedParts(date);
  return `${p.weekday} ${pad(p.day)} ${p.monthName}, ${pad(p.hour)}:${pad(p.minute)}`;
}

/** ISO-8601 with the facility offset and minute precision, e.g. "2026-10-15T10:00+07:00". */
export function localIso(date: Date | null | undefined) {
  if (!date) return "";
  const p = zonedParts(date);
  const offset = Math.round(offsetMs(date) / 60_000);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export const minutes = (count: number) => count * 60_000;
export const hours = (count: number) => count * 3_600_000;
export const days = (count: number) => count * 86_400_000;
