import seed from "../../data/db.json";
import { LocalApiError } from "./errors";
import type { KeyValueStorage } from "./storage";

// The browser-side database: one JSON document in localStorage, started from data/db.json.

export type Role = "USER" | "ADMIN" | "FACILITY_ADMIN";
export type BookingStatus = "CONFIRMED" | "PENDING_APPROVAL" | "CANCELLED" | "COMPLETED" | "NO_SHOW" | "REJECTED";

export type UserRec = {
  id: number;
  email: string;
  full_name: string;
  department: string | null;
  team: string | null;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  password_hash: string;
  /** Bumped to revoke the sessions of this user. */
  token_version: number;
};

export type FacilityRec = { id: number; name: string };

export type RoomRec = {
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
};

export type BookingRec = {
  id: number;
  room_id: number;
  organizer_id: number;
  title: string;
  description: string | null;
  attendee_count: number;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
  recurrence_rule: string | null;
  checked_in_at: string | null;
  series_id: string | null;
  decision_note: string | null;
  check_in_reminder_sent: boolean;
  participants: string[];
};

export type MaintenanceRec = { id: number; room_id: number; starts_at: string; ends_at: string; reason: string };
export type CheckInRec = { id: number; booking_id: number; checked_in_by: number; checked_in_at: string; method: string };
export type NotificationRec = {
  id: number;
  user_id: number;
  title: string;
  message: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
};
export type AuditRec = {
  id: number;
  user_id: number | null;
  action: string;
  entity: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};
/** A short-lived code shown as a QR code at a room. */
export type CheckInCodeRec = { code: string; room_id: number; expires_at: string };
/** A failed sign-in or reset request, for the sliding-window limits. */
export type RateEventRec = { bucket: string; key: string; at: string };

export type Data = {
  version: 1;
  users: UserRec[];
  facilities: FacilityRec[];
  rooms: RoomRec[];
  bookings: BookingRec[];
  maintenance: MaintenanceRec[];
  check_ins: CheckInRec[];
  notifications: NotificationRec[];
  audit_logs: AuditRec[];
  check_in_codes: CheckInCodeRec[];
  rate_events: RateEventRec[];
};

export const DATA_KEY = "meetinghub_db_v1";

type SeedFile = {
  users: Array<Omit<UserRec, "token_version">>;
  facilities: FacilityRec[];
  rooms: RoomRec[];
};

function fromSeed(): Data {
  const file = structuredClone(seed) as SeedFile;
  return {
    version: 1,
    users: file.users.map((user) => ({ ...user, token_version: 0 })),
    facilities: file.facilities,
    rooms: file.rooms,
    bookings: [],
    maintenance: [],
    check_ins: [],
    notifications: [],
    audit_logs: [],
    check_in_codes: [],
    rate_events: [],
  };
}

export class Database {
  private constructor(
    readonly data: Data,
    private readonly storage: KeyValueStorage,
    private readonly baseline: string,
  ) {}

  /** Read the current data, so changes made in another tab of this browser are always seen. */
  static open(storage: KeyValueStorage): Database {
    const raw = storage.get(DATA_KEY);
    let data: Data | undefined;
    if (raw) {
      try {
        data = JSON.parse(raw) as Data;
      } catch {
        data = undefined;
      }
    }
    data ??= fromSeed();
    return new Database(data, storage, JSON.stringify(data));
  }

  /** Write the data back, but only when something changed. */
  save() {
    const next = JSON.stringify(this.data);
    if (next === this.baseline) return;
    try {
      this.storage.set(DATA_KEY, next);
    } catch {
      throw new LocalApiError(
        507,
        "STORAGE_FULL",
        "The browser storage is full. Remove room photos or clear old data, then try again.",
      );
    }
  }

  nextId(rows: Array<{ id: number }>) {
    return rows.reduce((highest, row) => Math.max(highest, row.id), 0) + 1;
  }

  user(id: number) {
    return this.data.users.find((user) => user.id === id);
  }

  room(id: number) {
    return this.data.rooms.find((room) => room.id === id);
  }

  booking(id: number) {
    return this.data.bookings.find((booking) => booking.id === id);
  }
}
