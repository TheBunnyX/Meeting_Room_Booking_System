import { describe, expect, it } from "vitest";
import { calendarDateKey, formatTime, initials, isoDateKey, localInputToIso, monthGrid, toLocalInputValue } from "../lib/datetime";

describe("calendarDateKey", () => {
  it("pads the month and day and treats the month as zero-based", () => {
    expect(calendarDateKey(2026, 0, 5)).toBe("2026-01-05");
    expect(calendarDateKey(2026, 11, 31)).toBe("2026-12-31");
  });
});

describe("local datetime inputs", () => {
  it("round-trips a datetime-local value through an ISO instant", () => {
    const iso = localInputToIso("2026-10-09T09:30");

    expect(iso).toBe(new Date(2026, 9, 9, 9, 30).toISOString());
    expect(toLocalInputValue(iso!)).toBe("2026-10-09T09:30");
    expect(isoDateKey(iso!)).toBe("2026-10-09");
  });

  it("always produces an instant with an explicit UTC offset", () => {
    expect(localInputToIso("2026-10-09T09:30")).toMatch(/Z$/);
  });

  it("returns null for empty or malformed input", () => {
    expect(localInputToIso("")).toBeNull();
    expect(localInputToIso("not-a-date")).toBeNull();
  });
});

describe("monthGrid", () => {
  it("starts weeks on Monday", () => {
    // 1 October 2026 is a Thursday: three leading blanks, then 31 days.
    const cells = monthGrid(2026, 9);

    expect(cells.slice(0, 4)).toEqual([null, null, null, 1]);
    expect(cells).toHaveLength(3 + 31);
  });

  it("puts a Sunday-first month at the end of the first week", () => {
    // 1 November 2026 is a Sunday.
    expect(monthGrid(2026, 10).slice(0, 7)).toEqual([null, null, null, null, null, null, 1]);
  });

  it("handles leap years", () => {
    expect(monthGrid(2028, 1).filter((day) => day !== null)).toHaveLength(29);
  });
});

describe("initials", () => {
  it("uses the first and last name", () => {
    expect(initials("System Administrator")).toBe("SA");
    expect(initials("Ada  Byron  Lovelace")).toBe("AL");
  });

  it("falls back for single or missing names", () => {
    expect(initials("Mongkhon")).toBe("MO");
    expect(initials("")).toBe("?");
    expect(initials(null)).toBe("?");
  });
});

describe("formatTime", () => {
  it("shows a clock time in the viewer's local time", () => {
    expect(formatTime(new Date(2026, 9, 12, 9, 30).toISOString())).toMatch(/^9:30\sAM$/);
    expect(formatTime(new Date(2026, 9, 12, 15, 0).toISOString())).toMatch(/^3:00\sPM$/);
  });
});
