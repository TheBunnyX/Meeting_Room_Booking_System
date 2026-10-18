"use client";

import { useState, type FormEvent } from "react";
import { showError } from "../../lib/alerts";
import { apiFetch } from "../../lib/api";
import { localInputToIso } from "../../lib/datetime";
import type { Maintenance, Room } from "../../lib/types";
import type { Perform } from "./AdminView";

type MaintenancePanelProps = { rooms: Room[]; maintenance: Maintenance[]; perform: Perform };

export function MaintenancePanel({ rooms, maintenance, perform }: MaintenancePanelProps) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    // The inputs hold local wall-clock time; send unambiguous instants.
    const startsAt = localInputToIso(String(form.get("starts_at")));
    const endsAt = localInputToIso(String(form.get("ends_at")));
    if (!startsAt || !endsAt || endsAt <= startsAt) {
      void showError("Ends must be after Starts.", "Invalid time");
      return;
    }
    setSaving(true);
    const saved = await perform(
      () => apiFetch("/api/v1/maintenance", { method: "POST", json: { room_id: Number(form.get("room_id")), starts_at: startsAt, ends_at: endsAt, reason: form.get("reason") } }),
      "Maintenance window added.",
      "Maintenance failed",
    );
    setSaving(false);
    if (saved) setShowForm(false);
  }

  const remove = (item: Maintenance) => perform(() => apiFetch(`/api/v1/maintenance/${item.id}`, { method: "DELETE" }), "Maintenance window removed.", "Maintenance removal failed");

  return <div className="panel">
    <div className="section-head"><div><p className="eyebrow">Operations</p><h2>Maintenance windows</h2></div><button type="button" className="primary small-button" aria-expanded={showForm} onClick={() => setShowForm(!showForm)}>{showForm ? "Close" : "Block a room"}</button></div>
    {showForm && <form className="admin-form" onSubmit={submit}>
      <select name="room_id" required aria-label="Room">{rooms.filter((room) => room.is_active).map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select>
      <input name="reason" required minLength={2} maxLength={300} placeholder="Reason" aria-label="Reason" />
      <label>Starts<input name="starts_at" required type="datetime-local" /></label>
      <label>Ends<input name="ends_at" required type="datetime-local" /></label>
      <button className="primary" disabled={saving}>{saving ? "Adding…" : "Add maintenance"}</button>
    </form>}
    <div className="admin-list">
      {maintenance.length ? maintenance.map((item) => <div className="admin-row" key={item.id}>
        <div><strong>{item.room_name}</strong><small>{new Date(item.starts_at).toLocaleString()} – {new Date(item.ends_at).toLocaleString()} · {item.reason}</small></div>
        <button type="button" className="text-button danger" onClick={() => remove(item)}>Remove</button>
      </div>) : <p className="empty">No maintenance windows.</p>}
    </div>
  </div>;
}
