"use client";

import { useCallback, useEffect, useState } from "react";
import { chooseCancelScope, confirmAction, showError, showSuccess } from "../../lib/alerts";
import { apiFetch, errorMessage } from "../../lib/api";
import { formatDateTime } from "../../lib/datetime";
import type { Booking, BookingPolicy, CheckInResult } from "../../lib/types";

type MyBookingsProps = { version: number; onEdit: (booking: Booking) => void; onChanged: () => void };

const ACTIVE = new Set(["CONFIRMED", "PENDING_APPROVAL"]);

/** Whether check-in is open right now, using the window the backend publishes in its policy. */
function canCheckIn(booking: Booking, policy: BookingPolicy | null) {
  if (!policy || booking.status !== "CONFIRMED" || booking.checked_in_at) return false;
  const start = new Date(booking.starts_at).getTime();
  const now = Date.now();
  return now >= start - policy.check_in_opens_minutes_before * 60_000 && now <= start + policy.check_in_grace_minutes * 60_000;
}

export function MyBookings({ version, onEdit, onChanged }: MyBookingsProps) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [policy, setPolicy] = useState<BookingPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [items, rules] = await Promise.all([
        apiFetch<Booking[]>("/api/v1/bookings/my"),
        apiFetch<BookingPolicy>("/api/v1/booking-policy"),
      ]);
      setBookings(items);
      setPolicy(rules);
    } catch (reason) {
      setError(errorMessage(reason, "Your bookings could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, version]);

  async function cancel(booking: Booking) {
    // A weekly booking can be cancelled one meeting at a time or as a whole.
    const scope = booking.series_id
      ? await chooseCancelScope()
      : (await confirmAction("This booking will be cancelled and the room will become available.", "Cancel booking")) ? "one" : null;
    if (!scope) return;
    setBusyId(booking.id);
    try {
      if (scope === "series") {
        const result = await apiFetch<{ cancelled: number }>(`/api/v1/bookings/${booking.id}/cancel-series`, { method: "POST" });
        void showSuccess(`${result.cancelled} ${result.cancelled === 1 ? "meeting was" : "meetings were"} cancelled.`, "Series cancelled");
      } else {
        await apiFetch<Booking>(`/api/v1/bookings/${booking.id}/cancel`, { method: "POST" });
        void showSuccess("The booking has been cancelled.", "Booking cancelled");
      }
      onChanged();
    } catch (reason) {
      void showError(errorMessage(reason, "This booking could not be cancelled."), "Cancellation failed");
    } finally {
      setBusyId(null);
    }
  }

  async function checkIn(booking: Booking) {
    setBusyId(booking.id);
    try {
      const result = await apiFetch<CheckInResult>(`/api/v1/bookings/${booking.id}/check-in`, { method: "POST" });
      setBookings((current) => current.map((item) => item.id === booking.id ? { ...item, checked_in_at: result.checked_in_at } : item));
      void showSuccess("Check-in recorded.", "Check-in");
    } catch (reason) {
      void showError(errorMessage(reason, "Check-in could not be recorded."), "Check-in failed");
    } finally {
      setBusyId(null);
    }
  }

  return <div className="panel">
    <div className="section-head"><div><p className="eyebrow">03 / Booking management</p><h2>My bookings</h2></div><span className="section-meta">{bookings.length.toString().padStart(2, "0")}</span></div>
    <div className="booking-list">
      {error ? <div className="booking-state" role="alert"><p className="error">{error}</p><button type="button" className="text-button" onClick={load}>Try again</button></div>
        : loading && !bookings.length ? <p className="empty" role="status">Loading your bookings…</p>
        : !bookings.length ? <p className="empty">No bookings yet. Your next meeting will appear here.</p>
        : bookings.map((booking) => {
          const busy = busyId === booking.id;
          return <div className="booking-row" key={booking.id}>
            <div>
              <p>{booking.title}</p>
              <small>{booking.room_name} · {formatDateTime(booking.starts_at)}{booking.series_id ? " · Weekly" : ""}{booking.checked_in_at ? " · Checked in" : ""}</small>
              {booking.status === "REJECTED" && booking.decision_note && <small className="booking-note">Reason: {booking.decision_note}</small>}
            </div>
            <div className="booking-actions">
              <span className={`status status-${booking.status.toLowerCase()}`}>{booking.status.replaceAll("_", " ")}</span>
              {ACTIVE.has(booking.status) && <>
                <button type="button" className="text-button" disabled={busy} onClick={() => onEdit(booking)}>Edit</button>
                <button type="button" className="text-button danger" disabled={busy} onClick={() => cancel(booking)}>Cancel</button>
              </>}
              {canCheckIn(booking, policy) && <button type="button" className="text-button" disabled={busy} onClick={() => checkIn(booking)}>{busy ? "Checking in…" : "Check in"}</button>}
            </div>
          </div>;
        })}
    </div>
  </div>;
}
