"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "../../app/components/AppShell";
import { Icon } from "../../app/components/icons";
import { showSuccess } from "../../lib/alerts";
import { apiFetch, errorMessage } from "../../lib/api";
import { todayKey } from "../../lib/datetime";
import type { Booking, Room } from "../../lib/types";
import { BookingDialog, type BookingDraft } from "./BookingDialog";
import { InvitedBookings } from "./InvitedBookings";
import { MyBookings } from "./MyBookings";
import { RoomSearch } from "./RoomSearch";
import { ScheduleCalendar } from "./ScheduleCalendar";

export type WorkspaceViewName = "home" | "bookings" | "calendar";

const VIEWS: Record<WorkspaceViewName, { routeClass: string }> = {
  home: { routeClass: "route-home" },
  bookings: { routeClass: "route-bookings" },
  calendar: { routeClass: "route-calendar" },
};

export function WorkspaceView({ view }: { view: WorkspaceViewName }) {
  return <AppShell routeClass={VIEWS[view].routeClass} eyebrow="Workspace / MeetingHub" title="Make space for good work.">
    {() => <Workspace view={view} />}
  </AppShell>;
}

function Workspace({ view }: { view: WorkspaceViewName }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [roomsError, setRoomsError] = useState("");
  const [draft, setDraft] = useState<BookingDraft | null>(null);
  // Bumped after any change to bookings so the lists and calendar reload.
  const [version, setVersion] = useState(0);

  const loadRooms = useCallback(async () => {
    setRoomsLoading(true);
    setRoomsError("");
    try {
      setRooms(await apiFetch<Room[]>("/api/v1/rooms"));
    } catch (error) {
      setRoomsError(errorMessage(error, "Rooms could not be loaded."));
    } finally {
      setRoomsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  function editBooking(booking: Booking) {
    const room = rooms.find((item) => item.id === booking.room_id);
    setDraft({ roomId: booking.room_id, roomName: room?.name ?? booking.room_name, booking });
  }

  function onSaved(saved: Booking, wasEdit: boolean) {
    setDraft(null);
    setVersion((value) => value + 1);
    const pending = saved.status === "PENDING_APPROVAL";
    if (wasEdit) void showSuccess(pending ? "Your changes were saved and now await approval." : "Your booking has been updated.", "Booking updated");
    else void showSuccess(pending ? "Your request was sent for approval." : "Your room has been reserved.", pending ? "Awaiting approval" : "Booking confirmed");
  }

  return <>
    {view === "home" && <>
      <section className="hero" id="top"><div><p className="eyebrow">A better place to meet</p><h1>Make space for good work.</h1></div><div className="hero-copy"><p>Find the right room, at the right time. MeetingHub keeps the logistics quiet, so your team can focus on what matters.</p><a className="primary" href="#rooms">Explore rooms <Icon name="right" size={15} /></a></div></section>
      <RoomSearch
        rooms={rooms}
        loading={roomsLoading}
        error={roomsError}
        version={version}
        onRetry={loadRooms}
        onBook={(room, slot) => setDraft({ roomId: room.id, roomName: room.name, startsAt: `${slot.date}T${slot.startTime}`, endsAt: `${slot.date}T${slot.endTime}` })}
      />
    </>}
    {view !== "home" && <section className="lower-grid" id="bookings">
      <ScheduleCalendar version={version} initialDate={todayKey()} />
      {view === "bookings" && <>
        <MyBookings version={version} onEdit={editBooking} onChanged={() => setVersion((value) => value + 1)} />
        <InvitedBookings version={version} />
      </>}
    </section>}
    {draft && <BookingDialog draft={draft} rooms={rooms} onClose={() => setDraft(null)} onSaved={onSaved} />}
  </>;
}
