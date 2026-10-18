"use client";

import { askReason } from "../../lib/alerts";
import { apiFetch } from "../../lib/api";
import { formatDateTime, formatTimeRange } from "../../lib/datetime";
import type { Booking } from "../../lib/types";
import type { Perform } from "./AdminView";

export function ApprovalsPanel({ pending, perform }: { pending: Booking[]; perform: Perform }) {
  const approve = (booking: Booking) =>
    perform(() => apiFetch(`/api/v1/bookings/${booking.id}/approve`, { method: "POST" }), "Booking approved.", "Decision could not be saved");

  async function reject(booking: Booking) {
    // The reason is sent to the person who asked for the room.
    const reason = await askReason("Reject this request?", `${booking.organizer_name} will be told why “${booking.title}” was rejected.`, "Reject request");
    if (!reason) return;
    await perform(() => apiFetch(`/api/v1/bookings/${booking.id}/reject`, { method: "POST", json: { reason } }), "Booking rejected.", "Decision could not be saved");
  }

  return <div className="panel">
    <div className="section-head"><div><p className="eyebrow">Approvals</p><h2>Booking requests</h2></div><span className="section-meta">{pending.length.toString().padStart(2, "0")}</span></div>
    <div className="admin-list">
      {pending.length ? pending.map((booking) => <div className="admin-row" key={booking.id}>
        <div><strong>{booking.title}{booking.series_id ? " · Weekly" : ""}</strong><small>{booking.room_name} · {formatDateTime(booking.starts_at)} ({formatTimeRange(booking.starts_at, booking.ends_at)}) · {booking.attendee_count} people · requested by {booking.organizer_name}</small></div>
        <div className="admin-row-actions"><button type="button" className="text-button" onClick={() => approve(booking)}>Approve</button><button type="button" className="text-button danger" onClick={() => reject(booking)}>Reject</button></div>
      </div>) : <p className="empty">No bookings are waiting for approval.</p>}
    </div>
  </div>;
}
