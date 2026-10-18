// Shapes returned by the in-browser API (see lib/local/handlers). Keep in sync with them.

export type Role = "USER" | "ADMIN" | "FACILITY_ADMIN";
export type BookingStatus = "CONFIRMED" | "PENDING_APPROVAL" | "CANCELLED" | "COMPLETED" | "NO_SHOW" | "REJECTED";
export type AvailabilityStatus = "Available" | "Booked" | "Maintenance";

export type User = {
  id: number;
  email: string;
  full_name: string;
  department: string | null;
  team: string | null;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
};

export type TokenResponse = { access_token: string; token_type: string; user: User };
export type Participant = { id: number; email: string; full_name: string };
export type Facility = { id: number; name: string };

export type Room = {
  id: number;
  name: string;
  building: string;
  floor: string;
  capacity: number;
  image_url: string | null;
  opens_at: string;
  closes_at: string;
  requires_approval: boolean;
  is_active: boolean;
  facility_ids: number[];
  facility_names: string[];
};

export type AvailabilityRoom = Room & { status: AvailabilityStatus; next_booking_starts_at: string | null };

/** A period during which a room cannot be booked. */
export type Occupancy = {
  room_id: number;
  kind: "booking" | "maintenance";
  starts_at: string;
  ends_at: string;
  label: string;
  status: BookingStatus | null;
};

export type ScheduleBooking = {
  id: number;
  room_id: number;
  title: string;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
  room_name: string;
  organizer_name: string;
};

export type Booking = ScheduleBooking & {
  description: string | null;
  attendee_count: number;
  participant_emails: string[];
  checked_in_at: string | null;
  /** Shared by every occurrence of a weekly booking; null for one-off bookings. */
  series_id: string | null;
  /** Reason given by the manager who rejected the request. */
  decision_note: string | null;
};

export type CheckInResult = { message: string; checked_in_at: string; booking_id: number; title: string; room_name: string };

/** A short-lived signed code for the QR shown on the screen at a room. */
export type CheckInToken = { token: string; expires_in: number; room_name: string };

export type Notification = {
  id: number;
  title: string;
  message: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
};

export type NotificationList = { items: Notification[]; unread_count: number };

export type Maintenance = {
  id: number;
  room_id: number;
  room_name: string;
  starts_at: string;
  ends_at: string;
  reason: string;
};

export type Dashboard = { bookings_today: number; active_rooms: number; cancelled_bookings: number; no_shows: number };

export type Report = {
  total_bookings: number;
  cancelled_bookings: number;
  rejected_bookings: number;
  no_show_bookings: number;
  cancellation_rate: number;
  no_show_rate: number;
  most_used_rooms: { room: string; bookings: number }[];
};

export type AuditLog = {
  id: number;
  created_at: string;
  actor_name: string | null;
  actor_email: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
};

export type BookingPolicy = {
  max_duration_hours: number;
  max_advance_days: number;
  check_in_opens_minutes_before: number;
  check_in_grace_minutes: number;
  recurring_booking_supported: boolean;
  timezone: string;
};

export function isManager(role: Role | undefined | null) {
  return role === "ADMIN" || role === "FACILITY_ADMIN";
}
