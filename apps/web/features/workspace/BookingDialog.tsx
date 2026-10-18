"use client";

import { useState, type FormEvent } from "react";
import { Icon } from "../../app/components/icons";
import { Modal } from "../../app/components/Modal";
import { ApiError, apiFetch, errorMessage } from "../../lib/api";
import { localInputToIso, toLocalInputValue } from "../../lib/datetime";
import type { Booking, Participant, Room } from "../../lib/types";
import { ParticipantPicker } from "./ParticipantPicker";

/** What the dialog opens with: a room plus either a slot for a new booking or a booking to edit. */
export type BookingDraft = { roomId: number; roomName: string; startsAt?: string; endsAt?: string; booking?: Booking };

type BookingDialogProps = {
  draft: BookingDraft;
  rooms: Room[];
  onClose: () => void;
  onSaved: (booking: Booking, wasEdit: boolean) => void;
};

type FormError = { message: string; field: string | null };

const MAX_BOOKING_MS = 4 * 60 * 60 * 1000;

export function BookingDialog({ draft, rooms, onClose, onSaved }: BookingDialogProps) {
  const editing = draft.booking;
  const [participants, setParticipants] = useState<Participant[]>(
    () => editing?.participant_emails.map((email) => ({ id: 0, email, full_name: email })) ?? [],
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<FormError | null>(null);

  // A field's message is shown next to it; anything else is shown above the submit button.
  const fieldError = (name: string) => error?.field === name ? <p className="error field-error" id={`${name}-error`} role="alert">{error.message}</p> : null;
  const describedBy = (name: string) => error?.field === name ? `${name}-error` : undefined;
  const known = new Set(["title", "room_id", "starts_at", "ends_at", "attendee_count", "participant_emails"]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const form = new FormData(event.currentTarget);
    const startsAt = localInputToIso(String(form.get("starts_at")));
    const endsAt = localInputToIso(String(form.get("ends_at")));
    // Checked here for quick feedback only; the API enforces the same rules.
    if (!startsAt || !endsAt || endsAt <= startsAt) {
      setError({ message: "Ends must be after Starts.", field: "ends_at" });
      return;
    }
    if (new Date(endsAt).getTime() - new Date(startsAt).getTime() > MAX_BOOKING_MS) {
      setError({ message: "A booking cannot be longer than 4 hours.", field: "ends_at" });
      return;
    }
    const payload = {
      room_id: Number(form.get("room_id")),
      title: String(form.get("title")).trim(),
      description: String(form.get("description") ?? "").trim(),
      attendee_count: Number(form.get("attendee_count")),
      starts_at: startsAt,
      ends_at: endsAt,
      participant_emails: participants.map((participant) => participant.email),
    };
    setSubmitting(true);
    setError(null);
    try {
      const saved = editing
        ? await apiFetch<Booking>(`/api/v1/bookings/${editing.id}`, { method: "PATCH", json: payload })
        : await apiFetch<Booking>("/api/v1/bookings", { method: "POST", json: { ...payload, recurrence_rule: String(form.get("recurrence_rule") ?? "") || null } });
      onSaved(saved, Boolean(editing));
    } catch (reason) {
      setError({
        message: errorMessage(reason, "The booking could not be saved."),
        field: reason instanceof ApiError ? reason.field : null,
      });
    } finally {
      setSubmitting(false);
    }
  }

  const activeRooms = rooms.filter((room) => room.is_active);
  // Keep the booking's own room selectable even when it is not in the list (inactive, or still
  // loading), so the form never silently switches to a different room.
  const roomListed = activeRooms.some((room) => room.id === draft.roomId);
  const maxPeople = Math.max(1, editing?.attendee_count ?? 1, ...activeRooms.map((room) => room.capacity));

  return <Modal labelledBy="book-title" onClose={onClose}>
    <div className="modal-header"><div><p className="eyebrow">{editing ? "Edit booking" : "Reserve a space"}</p><h2 id="book-title">{draft.roomName}</h2></div><button type="button" className="close" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button></div>
    <form onSubmit={submit}>
      <div className="form-grid">
        <div className="field full"><label htmlFor="title">Meeting name</label><input id="title" name="title" required minLength={2} maxLength={200} defaultValue={editing?.title} placeholder="e.g. Weekly project sync" aria-describedby={describedBy("title")} />{fieldError("title")}</div>
        <div className="field full"><label htmlFor="room_id">Room</label><select id="room_id" name="room_id" defaultValue={draft.roomId} aria-describedby={describedBy("room_id")}>{!roomListed && <option value={draft.roomId}>{draft.roomName}</option>}{activeRooms.map((room) => <option key={room.id} value={room.id}>{room.name} · {room.building} · up to {room.capacity}{room.requires_approval ? " · needs approval" : ""}</option>)}</select>{fieldError("room_id")}</div>
        <div className="field"><label htmlFor="starts_at">Starts</label><input id="starts_at" name="starts_at" type="datetime-local" required defaultValue={editing ? toLocalInputValue(editing.starts_at) : draft.startsAt} aria-describedby={describedBy("starts_at")} />{fieldError("starts_at")}</div>
        <div className="field"><label htmlFor="ends_at">Ends</label><input id="ends_at" name="ends_at" type="datetime-local" required defaultValue={editing ? toLocalInputValue(editing.ends_at) : draft.endsAt} aria-describedby={describedBy("ends_at")} />{fieldError("ends_at")}</div>
        <div className="field"><label htmlFor="attendee_count">People</label><input id="attendee_count" name="attendee_count" type="number" min="1" max={maxPeople} defaultValue={editing?.attendee_count ?? 2} required aria-describedby={describedBy("attendee_count")} />{fieldError("attendee_count")}</div>
        <ParticipantPicker selected={participants} onChange={setParticipants} />
        {fieldError("participant_emails")}
        {!editing && <div className="field full"><label htmlFor="recurrence_rule">Repeat</label><select id="recurrence_rule" name="recurrence_rule" defaultValue=""><option value="">Does not repeat</option><option value="weekly">Every week, up to 30 days ahead</option></select></div>}
        <div className="field full"><label htmlFor="description">Note <span>(optional)</span></label><textarea id="description" name="description" maxLength={2000} defaultValue={editing?.description ?? ""} placeholder="Anything your team should know?" /></div>
      </div>
      {error && !known.has(error.field ?? "") && <p className="error" role="alert">{error.message}</p>}
      <div className="modal-footer"><button className="primary" type="submit" disabled={submitting}>{submitting ? "Saving…" : editing ? "Save changes" : "Confirm booking"} <Icon name="right" size={15} /></button></div>
    </form>
  </Modal>;
}
