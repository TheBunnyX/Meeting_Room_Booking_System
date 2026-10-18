"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, errorMessage } from "../../lib/api";
import { Icon } from "../../app/components/icons";
import { calendarDateKey, formatTimeRange, todayKey } from "../../lib/datetime";
import { blockPosition, dayStart, hourLabel, hourSlots, isOpenDuring, overlapsHour, timelineWindow } from "../../lib/timeline";
import type { Occupancy, Room } from "../../lib/types";
import type { SearchSlot } from "./RoomSearch";

type DayTimelineProps = {
  date: string;
  rooms: Room[];
  /** Bumped when bookings change, to reload the day. */
  version: number;
  onBook: (room: Room, slot: SearchSlot) => void;
  onDateChange: (date: string) => void;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar day `offset` days from a `YYYY-MM-DD` key (DST-safe: works on calendar fields). */
function shiftDate(date: string, offset: number) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(year, month - 1, day + offset);
  return calendarDateKey(next.getFullYear(), next.getMonth(), next.getDate());
}

/** One row per room across the day: what is taken, and free hours that can be clicked to book. */
export function DayTimeline({ date, rooms, version, onBook, onDateChange }: DayTimelineProps) {
  const [blocks, setBlocks] = useState<Occupancy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const dayStartMs = useMemo(() => dayStart(date).getTime(), [date]);

  const load = useCallback(async () => {
    if (Number.isNaN(dayStartMs)) return;
    const params = new URLSearchParams({
      starts_at: new Date(dayStartMs).toISOString(),
      ends_at: new Date(dayStartMs + DAY_MS).toISOString(),
    });
    setLoading(true);
    setError("");
    try {
      setBlocks(await apiFetch<Occupancy[]>(`/api/v1/rooms/occupancy?${params}`));
    } catch (reason) {
      setError(errorMessage(reason, "The day view could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [dayStartMs]);

  useEffect(() => {
    void load();
  }, [load, version]);

  const window = useMemo(() => timelineWindow(rooms), [rooms]);
  const hours = hourSlots(window);
  const blocksByRoom = useMemo(() => {
    const byRoom = new Map<number, Occupancy[]>();
    for (const block of blocks) byRoom.set(block.room_id, [...(byRoom.get(block.room_id) ?? []), block]);
    return byRoom;
  }, [blocks]);
  const dayLabel = Number.isNaN(dayStartMs) ? "" : new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date(dayStartMs));
  const now = Date.now();

  if (!rooms.length || Number.isNaN(dayStartMs)) return null;

  return <div className="timeline panel">
    <div className="section-head">
      <div><p className="eyebrow">Day view</p><h2>{dayLabel}</h2></div>
      <div className="day-nav">
        <button type="button" aria-label="Previous day" onClick={() => onDateChange(shiftDate(date, -1))}><Icon name="left" size={17} /></button>
        <button type="button" className="day-nav-today" disabled={date === todayKey()} onClick={() => onDateChange(todayKey())}>Today</button>
        <button type="button" aria-label="Next day" onClick={() => onDateChange(shiftDate(date, 1))}><Icon name="right" size={17} /></button>
      </div>
      <ul className="timeline-legend" aria-label="Legend"><li><span className="swatch booked" /> Booked</li><li><span className="swatch pending" /> Awaiting approval</li><li><span className="swatch maintenance" /> Maintenance</li><li><span className="swatch closed" /> Closed or past</li></ul>
    </div>
    {error ? <div className="booking-state" role="alert"><p className="error">{error}</p><button type="button" className="text-button" onClick={load}>Try again</button></div>
      : <div className="timeline-scroll" aria-busy={loading}>
        <div className="timeline-inner" style={{ "--timeline-hours": hours.length } as React.CSSProperties}>
          <div className="timeline-row timeline-header" aria-hidden="true">
            <div className="timeline-room" />
            <div className="timeline-track">{hours.map((hour) => <span className="timeline-hour-label" key={hour}>{hourLabel(hour)}</span>)}</div>
          </div>
          {rooms.map((room) => {
            const roomBlocks = blocksByRoom.get(room.id) ?? [];
            return <div className="timeline-row" key={room.id}>
              <div className="timeline-room"><strong>{room.name}</strong><small>up to {room.capacity}</small></div>
              <div className="timeline-track">
                {hours.map((hour) => {
                  const taken = roomBlocks.some((block) => overlapsHour(block.starts_at, block.ends_at, dayStartMs, hour));
                  const past = dayStartMs + hour * 60 * 60 * 1000 < now;
                  const closed = !isOpenDuring(room, hour);
                  return <button type="button" className={`timeline-hour ${closed || past ? "closed" : ""}`} key={hour} disabled={taken || past || closed} aria-label={`Book ${room.name} at ${hourLabel(hour)}`} onClick={() => onBook(room, { date, startTime: hourLabel(hour), endTime: hourLabel(hour + 1) })} />;
                })}
                {roomBlocks.map((block) => {
                  const position = blockPosition(block.starts_at, block.ends_at, dayStartMs, window);
                  if (!position) return null;
                  const kind = block.kind === "maintenance" ? "maintenance" : block.status === "PENDING_APPROVAL" ? "pending" : "booked";
                  const description = `${block.label} · ${formatTimeRange(block.starts_at, block.ends_at)}`;
                  return <span className={`timeline-block ${kind}`} key={`${block.kind}-${block.starts_at}-${block.ends_at}`} style={{ left: `${position.left}%`, width: `${position.width}%` }} title={description}><span>{block.label}</span><span className="sr-only">, {formatTimeRange(block.starts_at, block.ends_at)}</span></span>;
                })}
              </div>
            </div>;
          })}
        </div>
      </div>}
    <p className="timeline-hint">Select a free hour to start a booking for that room.</p>
  </div>;
}
