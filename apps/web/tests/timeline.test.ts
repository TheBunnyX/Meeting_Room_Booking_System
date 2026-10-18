import { describe, expect, it } from "vitest";
import { blockPosition, dayStart, hourLabel, hourSlots, isOpenDuring, overlapsHour, timelineWindow } from "../lib/timeline";

const day = dayStart("2026-10-12").getTime();
const at = (hour: number, minute = 0) => new Date(2026, 9, 12, hour, minute).toISOString();
const window = { startHour: 8, endHour: 18 };

describe("timelineWindow", () => {
  it("covers every room's opening hours, rounded out to whole hours", () => {
    const rooms = [{ opens_at: "08:30", closes_at: "17:00" }, { opens_at: "09:00", closes_at: "20:15" }];

    expect(timelineWindow(rooms)).toEqual({ startHour: 8, endHour: 21 });
  });

  it("falls back to office hours when there are no rooms", () => {
    expect(timelineWindow([])).toEqual({ startHour: 8, endHour: 18 });
  });
});

describe("hourSlots", () => {
  it("lists each hour that starts inside the window", () => {
    expect(hourSlots({ startHour: 8, endHour: 11 })).toEqual([8, 9, 10]);
    expect(hourLabel(8)).toBe("08:00");
  });
});

describe("blockPosition", () => {
  it("places a block as a percentage of the visible day", () => {
    expect(blockPosition(at(9), at(10), day, window)).toEqual({ left: 10, width: 10 });
    expect(blockPosition(at(13), at(15, 30), day, window)).toEqual({ left: 50, width: 25 });
  });

  it("clips blocks that start before or end after the window", () => {
    expect(blockPosition(at(6), at(9), day, window)).toEqual({ left: 0, width: 10 });
    expect(blockPosition(at(17), at(20), day, window)).toEqual({ left: 90, width: 10 });
  });

  it("hides blocks entirely outside the window", () => {
    expect(blockPosition(at(5), at(7), day, window)).toBeNull();
    expect(blockPosition(at(18), at(19), day, window)).toBeNull();
  });
});

describe("overlapsHour", () => {
  it("treats a block as occupying every hour it touches", () => {
    expect(overlapsHour(at(9, 30), at(10, 30), day, 9)).toBe(true);
    expect(overlapsHour(at(9, 30), at(10, 30), day, 10)).toBe(true);
  });

  it("leaves adjacent hours free", () => {
    expect(overlapsHour(at(9), at(10), day, 10)).toBe(false);
    expect(overlapsHour(at(9), at(10), day, 8)).toBe(false);
  });
});

describe("isOpenDuring", () => {
  it("requires the whole hour to be inside opening hours", () => {
    const room = { opens_at: "08:30", closes_at: "18:00" };

    expect(isOpenDuring(room, 8)).toBe(false);
    expect(isOpenDuring(room, 9)).toBe(true);
    expect(isOpenDuring(room, 17)).toBe(true);
    expect(isOpenDuring(room, 18)).toBe(false);
  });
});
