"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../../app/components/icons";
import { apiFetch, errorMessage } from "../../lib/api";
import { calendarDateKey, formatTime, formatTimeRange, isoDateKey, monthGrid, todayKey } from "../../lib/datetime";
import type { ScheduleBooking } from "../../lib/types";

const DAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export function ScheduleCalendar({ version, initialDate }: { version: number; initialDate: string }) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [bookings, setBookings] = useState<ScheduleBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
    const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    const params = new URLSearchParams({ starts_at: monthStart.toISOString(), ends_at: monthEnd.toISOString() });
    setLoading(true);
    setError("");
    try {
      setBookings(await apiFetch<ScheduleBooking[]>(`/api/v1/bookings/schedule?${params}`));
    } catch (reason) {
      setError(errorMessage(reason, "The shared schedule could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load, version]);

  const bookingsByDay = useMemo(() => {
    const days = new Map<string, ScheduleBooking[]>();
    for (const booking of bookings) {
      const key = isoDateKey(booking.starts_at);
      days.set(key, [...(days.get(key) ?? []), booking]);
    }
    return days;
  }, [bookings]);

  function changeMonth(offset: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    setMonth(next);
    setSelectedDate(calendarDateKey(next.getFullYear(), next.getMonth(), 1));
  }

  const today = todayKey();
  const selectedBookings = bookingsByDay.get(selectedDate) ?? [];
  const monthLabel = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(month);
  const selectedLabel = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(`${selectedDate}T12:00:00`));

  return <div className="panel" id="schedule">
    <div className="calendar-head">
      <div><p className="eyebrow">02 / Your schedule</p><h2>{monthLabel}</h2></div>
      <div className="calendar-nav"><button type="button" aria-label="Previous month" onClick={() => changeMonth(-1)}><Icon name="left" size={17} /></button> <button type="button" aria-label="Next month" onClick={() => changeMonth(1)}><Icon name="right" size={17} /></button></div>
    </div>
    <div className="days">
      {DAY_LABELS.map((day) => <div className="day-label" key={day}>{day}</div>)}
      {monthGrid(month.getFullYear(), month.getMonth()).map((day, index) => {
        if (day === null) return <div className="day empty-day" aria-hidden="true" key={`empty-${index}`} />;
        const key = calendarDateKey(month.getFullYear(), month.getMonth(), day);
        const dayBookings = bookingsByDay.get(key) ?? [];
        const selected = key === selectedDate;
        const label = `${key}${dayBookings.length ? `, ${dayBookings.length} booking${dayBookings.length > 1 ? "s" : ""}` : ""}`;
        return <button type="button" className={`day ${key === today ? "today" : ""} ${dayBookings.length ? "booked" : ""} ${selected ? "selected" : ""}`} key={key} onClick={() => setSelectedDate(key)} aria-label={label} aria-pressed={selected}>
          <span className="day-number">{day}</span>
          <span className="day-events">
            {dayBookings.slice(0, 3).map((booking, eventIndex) => <span className={`day-event event-${eventIndex % 3}`} key={booking.id}><strong>{booking.title}</strong><small>{formatTimeRange(booking.starts_at, booking.ends_at)}</small></span>)}
            {dayBookings.length > 3 && <span className="day-more">+{dayBookings.length - 3} more</span>}
          </span>
        </button>;
      })}
    </div>
    <div className="calendar-selection" aria-live="polite">
      <div className="calendar-selection-head"><div><p className="eyebrow">Bookings on this day</p><h3>{selectedLabel}</h3></div><span className="calendar-count" aria-label={`${selectedBookings.length} ${selectedBookings.length === 1 ? "booking" : "bookings"}`}><strong>{selectedBookings.length}</strong> {selectedBookings.length === 1 ? "booking" : "bookings"}</span></div>
      {error ? <div className="booking-state"><p className="error">{error}</p><button type="button" className="text-button" onClick={load}>Try again</button></div>
        : loading ? <p className="empty">Loading the shared schedule…</p>
        : selectedBookings.length ? selectedBookings.map((booking, index) => <div className={`calendar-event event-${index % 3}`} key={booking.id}>
          <span className="calendar-event-time"><strong>{formatTime(booking.starts_at)}</strong><small>to {formatTime(booking.ends_at)}</small><span className="sr-only">{formatTimeRange(booking.starts_at, booking.ends_at)}</span></span>
          <div className="calendar-event-body"><strong>{booking.title}</strong><small>{booking.room_name}</small><small>Booked by {booking.organizer_name}</small></div>
          {booking.status === "PENDING_APPROVAL" && <span className="status status-pending_approval">AWAITING APPROVAL</span>}
        </div>)
        : <p className="empty">No bookings on this day.</p>}
    </div>
  </div>;
}
