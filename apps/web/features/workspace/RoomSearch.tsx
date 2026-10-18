"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../app/components/icons";
import { RoomImage } from "../../app/components/RoomImage";
import { apiFetch, errorMessage } from "../../lib/api";
import { localInputToIso, todayKey } from "../../lib/datetime";
import type { AvailabilityRoom, Room } from "../../lib/types";
import { DayTimeline } from "./DayTimeline";
import { EquipmentFilter } from "./EquipmentFilter";

export type SearchSlot = { date: string; startTime: string; endTime: string };

type RoomSearchProps = {
  rooms: Room[];
  loading: boolean;
  error: string;
  /** Bumped when bookings change, so availability shown here is never stale. */
  version: number;
  onRetry: () => void;
  onBook: (room: Room, slot: SearchSlot) => void;
};

export function RoomSearch({ rooms, loading, error, version, onRetry, onBook }: RoomSearchProps) {
  const [query, setQuery] = useState("");
  const [equipmentFilter, setEquipmentFilter] = useState<string[]>([]);
  const [capacityFilter, setCapacityFilter] = useState(0);
  const [buildingFilter, setBuildingFilter] = useState("");
  const [slot, setSlot] = useState<SearchSlot>(() => ({ date: todayKey(), startTime: "09:00", endTime: "10:00" }));
  // Result of the last availability check; null means "showing the plain room catalogue".
  const [availability, setAvailability] = useState<AvailabilityRoom[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");

  useEffect(() => {
    // A booking was just made or changed: the statuses from the last check may no longer be true.
    setAvailability(null);
  }, [version]);

  function changeSlot(change: Partial<SearchSlot>) {
    setSlot((current) => ({ ...current, ...change }));
    // Statuses belong to the slot that was checked; drop them once the slot changes.
    setAvailability(null);
    setCheckError("");
  }

  async function checkAvailability() {
    const startsAt = localInputToIso(`${slot.date}T${slot.startTime}`);
    const endsAt = localInputToIso(`${slot.date}T${slot.endTime}`);
    if (!startsAt || !endsAt || endsAt <= startsAt) {
      setCheckError("Choose an end time that is after the start time.");
      return;
    }
    const params = new URLSearchParams({ starts_at: startsAt, ends_at: endsAt });
    setChecking(true);
    setCheckError("");
    try {
      setAvailability(await apiFetch<AvailabilityRoom[]>(`/api/v1/rooms/availability?${params}`));
    } catch (reason) {
      setCheckError(errorMessage(reason, "Availability could not be loaded."));
    } finally {
      setChecking(false);
    }
  }

  const buildings = useMemo(() => Array.from(new Set(rooms.map((room) => room.building))).sort(), [rooms]);
  const equipment = useMemo(() => Array.from(new Set(rooms.flatMap((room) => room.facility_names))).sort(), [rooms]);
  const matches = useMemo(() => {
    const text = query.trim().toLowerCase();
    return (room: Room) =>
      `${room.name} ${room.building} ${room.facility_names.join(" ")}`.toLowerCase().includes(text) &&
      // A room must have every piece of equipment that is ticked.
      equipmentFilter.every((item) => room.facility_names.includes(item)) &&
      (!capacityFilter || room.capacity >= capacityFilter) &&
      (!buildingFilter || room.building === buildingFilter);
  }, [query, equipmentFilter, capacityFilter, buildingFilter]);
  const source: (Room & { status?: AvailabilityRoom["status"] })[] = availability ?? rooms;
  const filteredRooms = useMemo(() => source.filter(matches), [source, matches]);
  const timelineRooms = useMemo(() => rooms.filter(matches), [rooms, matches]);

  return <section id="rooms" className="rooms-section">
    <div className="section-head">
      <div><p className="eyebrow">01 / Search & availability</p><h2 className="section-title">Choose your room</h2></div>
      <span className="section-meta">{filteredRooms.length.toString().padStart(2, "0")} rooms</span>
    </div>
    <div className="filter-bar">
      <input className="search" aria-label="Search rooms" placeholder="Search by room, building or feature" value={query} onChange={(event) => setQuery(event.target.value)} />
      <input className="filter date-filter" type="date" aria-label="Booking date" value={slot.date} onChange={(event) => changeSlot({ date: event.target.value })} />
      <input className="filter time-filter" type="time" aria-label="Start time" value={slot.startTime} onChange={(event) => changeSlot({ startTime: event.target.value })} />
      <input className="filter time-filter" type="time" aria-label="End time" value={slot.endTime} onChange={(event) => changeSlot({ endTime: event.target.value })} />
      <select className="filter" aria-label="Filter room capacity" value={capacityFilter} onChange={(event) => setCapacityFilter(Number(event.target.value))}><option value="0">Any capacity</option><option value="6">6+ people</option><option value="12">12+ people</option></select>
      <select className="filter" aria-label="Filter building" value={buildingFilter} onChange={(event) => setBuildingFilter(event.target.value)}><option value="">All buildings</option>{buildings.map((building) => <option key={building} value={building}>{building}</option>)}</select>
      <EquipmentFilter options={equipment} selected={equipmentFilter} onChange={setEquipmentFilter} />
      <button type="button" className="primary availability-button" disabled={checking || loading} onClick={checkAvailability}>{checking ? "Checking…" : "Check availability"}</button>
    </div>
    {checkError && <p className="error" role="alert">{checkError}</p>}
    {error ? <div className="booking-state" role="alert"><p className="error">{error}</p><button type="button" className="text-button" onClick={onRetry}>Try again</button></div>
      : loading ? <div className="room-grid" role="status" aria-label="Loading rooms">{[0, 1, 2].map((item) => <div className="room-card skeleton skeleton-card" key={item} />)}</div>
      : !filteredRooms.length ? <p className="empty">{source.length ? "No rooms match these filters." : "No rooms are available yet."}</p>
      : <div className="room-grid">
        {filteredRooms.map((room, index) => {
          const unavailable = room.status === "Booked" || room.status === "Maintenance";
          return <article className="room-card" key={room.id}>
            <div className="room-visual">
              <RoomImage className="room-image" src={room.image_url} alt={`Interior of ${room.name}`} sizes="(max-width: 560px) 100vw, (max-width: 1100px) 50vw, 33vw" priority={index < 3} />
              <span className="room-tag">{room.building} · {room.floor}F</span>
              {room.status && <span className={`room-status ${room.status.toLowerCase()}`}>{room.status}</span>}
            </div>
            <div className="room-card-content">
              <div className="room-info"><div><h3 className="room-name">{room.name}</h3><p className="room-detail">{room.facility_names.slice(0, 2).join(" · ") || "Flexible workspace"}</p></div><div className="capacity">UP TO<br /><strong>{room.capacity}</strong> People</div></div>
              <button type="button" className="room-action" disabled={unavailable} onClick={() => onBook(room, slot)}>{unavailable ? room.status : "Book this room"} <Icon name="right" size={15} /></button>
            </div>
          </article>;
        })}
      </div>}
    {!loading && !error && <DayTimeline date={slot.date} rooms={timelineRooms} version={version} onBook={onBook} onDateChange={(date) => changeSlot({ date })} />}
  </section>;
}
