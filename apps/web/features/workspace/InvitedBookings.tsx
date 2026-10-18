"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, errorMessage } from "../../lib/api";
import { formatDateTime, formatTimeRange } from "../../lib/datetime";
import type { Booking } from "../../lib/types";

/** Upcoming meetings other people organised and invited the signed-in user to. */
export function InvitedBookings({ version }: { version: number }) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setBookings(await apiFetch<Booking[]>("/api/v1/bookings/invited"));
    } catch (reason) {
      setError(errorMessage(reason, "Your invitations could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, version]);

  return <div className="panel">
    <div className="section-head"><div><p className="eyebrow">04 / Invitations</p><h2>Meetings I&apos;m invited to</h2></div><span className="section-meta">{bookings.length.toString().padStart(2, "0")}</span></div>
    <div className="booking-list">
      {error ? <div className="booking-state" role="alert"><p className="error">{error}</p><button type="button" className="text-button" onClick={load}>Try again</button></div>
        : loading && !bookings.length ? <p className="empty" role="status">Loading your invitations…</p>
        : !bookings.length ? <p className="empty">No upcoming invitations.</p>
        : bookings.map((booking) => <div className="booking-row" key={booking.id}>
          <div>
            <p>{booking.title}</p>
            <small>{booking.room_name} · {formatDateTime(booking.starts_at)} ({formatTimeRange(booking.starts_at, booking.ends_at)})</small>
            <small className="booking-note">Organised by {booking.organizer_name}{booking.description ? ` · ${booking.description}` : ""}</small>
          </div>
          <div className="booking-actions"><span className={`status status-${booking.status.toLowerCase()}`}>{booking.status === "PENDING_APPROVAL" ? "AWAITING APPROVAL" : "CONFIRMED"}</span></div>
        </div>)}
    </div>
  </div>;
}
