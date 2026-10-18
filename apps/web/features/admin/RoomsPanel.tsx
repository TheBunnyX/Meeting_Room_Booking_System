"use client";

import { useState, type FormEvent } from "react";
import { apiFetch, assetUrl } from "../../lib/api";
import type { Facility, Room } from "../../lib/types";
import type { Perform } from "./AdminView";

type RoomsPanelProps = { rooms: Room[]; facilities: Facility[]; perform: Perform };

// `null` closes the form, "new" opens it empty, and a room id opens it for that room.
type Editing = number | "new" | null;

export function RoomsPanel({ rooms, facilities, perform }: RoomsPanelProps) {
  const [editing, setEditing] = useState<Editing>(null);
  const [saving, setSaving] = useState(false);
  // Read from the latest list so the form reflects uploads and deletions straight away.
  const editingRoom = typeof editing === "number" ? rooms.find((room) => room.id === editing) ?? null : null;

  async function run(action: () => Promise<unknown>, success: string, failure: string) {
    setSaving(true);
    try {
      return await perform(action, success, failure);
    } finally {
      setSaving(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    const payload = {
      name: form.get("name"),
      building: form.get("building"),
      floor: form.get("floor"),
      capacity: Number(form.get("capacity")),
      image_url: form.get("image_url") || null,
      opens_at: form.get("opens_at"),
      closes_at: form.get("closes_at"),
      requires_approval: form.get("requires_approval") === "on",
      facility_ids: facilities.filter((item) => form.get(`facility-${item.id}`) === "on").map((item) => item.id),
    };
    const saved = editingRoom
      ? await run(() => apiFetch(`/api/v1/rooms/${editingRoom.id}`, { method: "PATCH", json: { ...payload, is_active: form.get("is_active") === "on" } }), "Room updated.", "Room save failed")
      : await run(() => apiFetch("/api/v1/rooms", { method: "POST", json: payload }), "Room created.", "Room save failed");
    if (saved) setEditing(null);
  }

  function uploadImage(room: Room, file: File) {
    const body = new FormData();
    body.append("image", file);
    return run(() => apiFetch(`/api/v1/rooms/${room.id}/image`, { method: "POST", body }), "Room image uploaded.", "Image upload failed");
  }

  const deleteImage = (room: Room) => run(() => apiFetch(`/api/v1/rooms/${room.id}/image`, { method: "DELETE" }), "Room image deleted.", "Image deletion failed");
  const toggle = (room: Room) => room.is_active
    ? perform(() => apiFetch(`/api/v1/rooms/${room.id}`, { method: "DELETE" }), "Room deactivated.", "Room status update failed")
    : perform(() => apiFetch(`/api/v1/rooms/${room.id}/activate`, { method: "POST" }), "Room activated.", "Room status update failed");

  return <div className="panel">
    <div className="section-head"><div><p className="eyebrow">Spaces</p><h2>Room management</h2></div><button type="button" className="primary small-button" aria-expanded={editing !== null} onClick={() => setEditing(editing === null ? "new" : null)}>{editing === null ? "Add room" : "Close"}</button></div>
    {editing !== null && <form className="admin-form room-form" onSubmit={submit} key={editing}>
      <input name="name" required minLength={2} maxLength={120} placeholder="Room name" aria-label="Room name" defaultValue={editingRoom?.name} />
      <input name="building" required maxLength={100} placeholder="Building" aria-label="Building" defaultValue={editingRoom?.building} />
      <input name="floor" required maxLength={30} placeholder="Floor" aria-label="Floor" defaultValue={editingRoom?.floor} />
      <input name="capacity" required type="number" min="1" max="1000" aria-label="Capacity" defaultValue={editingRoom?.capacity ?? 1} />
      <input name="image_url" maxLength={500} placeholder="Image URL" aria-label="Image URL" defaultValue={editingRoom?.image_url ?? ""} key={editingRoom?.image_url ?? ""} />
      <label>Opens<input name="opens_at" required type="time" defaultValue={editingRoom?.opens_at ?? "08:00"} /></label>
      <label>Closes<input name="closes_at" required type="time" defaultValue={editingRoom?.closes_at ?? "18:00"} /></label>
      <label><input name="requires_approval" type="checkbox" defaultChecked={editingRoom?.requires_approval ?? false} /> Requires approval</label>
      {editingRoom && <>
        <label><input name="is_active" type="checkbox" defaultChecked={editingRoom.is_active} /> Active room</label>
        <div className="room-image-tools">
          {editingRoom.image_url
            // eslint-disable-next-line @next/next/no-img-element -- served by the API origin or an arbitrary URL
            ? <img className="room-image-preview" src={assetUrl(editingRoom.image_url)} alt={`${editingRoom.name} preview`} />
            : <p className="empty">No room image.</p>}
          <div className="room-image-actions">
            <label className="text-button upload-button">Upload image<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={saving} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadImage(editingRoom, file); event.currentTarget.value = ""; }} /></label>
            {editingRoom.image_url && <button type="button" className="text-button danger" disabled={saving} onClick={() => deleteImage(editingRoom)}>Delete image</button>}
          </div>
          <small>JPG, PNG or WebP · max 4 MB</small>
        </div>
      </>}
      <fieldset className="facility-checks"><legend>Facilities</legend>{facilities.map((item) => <label key={item.id}><input name={`facility-${item.id}`} type="checkbox" defaultChecked={editingRoom?.facility_ids.includes(item.id) ?? false} /> {item.name}</label>)}</fieldset>
      <button className="primary" disabled={saving}>{saving ? "Saving…" : editingRoom ? "Save room" : "Create room"}</button>
    </form>}
    <div className="admin-list">
      {rooms.length ? rooms.map((room) => <div className={`admin-row ${!room.is_active ? "muted" : ""}`} key={room.id}>
        <div><strong>{room.name}{!room.is_active ? " · Inactive" : ""}{room.requires_approval ? " · Approval required" : ""}</strong><small>{room.building} · Floor {room.floor} · up to {room.capacity} people · {room.opens_at}–{room.closes_at} · {room.facility_names.join(", ") || "No facilities"}</small></div>
        <div className="admin-row-actions"><a className="text-button" href={`/check-in-screen?room=${room.id}`} target="_blank" rel="noopener noreferrer">Check-in screen</a><button type="button" className="text-button" onClick={() => setEditing(room.id)}>Edit</button><button type="button" className="text-button danger" onClick={() => toggle(room)}>{room.is_active ? "Deactivate" : "Activate"}</button></div>
      </div>) : <p className="empty">No rooms yet.</p>}
    </div>
  </div>;
}
