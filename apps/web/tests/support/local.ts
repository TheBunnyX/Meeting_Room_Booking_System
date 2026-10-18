import { Database, DATA_KEY, type BookingRec } from "../../lib/local/database";
import { type Api, createApi } from "../../lib/local/router";
import { type KeyValueStorage, memoryStorage } from "../../lib/local/storage";

export type CallOptions = { json?: unknown; query?: Record<string, string | number | undefined>; body?: BodyInit };

export type TestApp = {
  api: Api;
  storage: KeyValueStorage;
  /** Move the clock the API sees. */
  setNow: (date: Date) => void;
  /** Sign in as someone through the real login route; the session replaces the previous one. */
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  // Tests read arbitrary response shapes, so the parsed body is deliberately loose.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: (method: string, path: string, options?: CallOptions) => Promise<{ status: number; body: any; headers: Headers }>;
  /** Read or change the stored data directly, bypassing the rules (for check-in and sweep tests). */
  data: () => Database;
  commit: (db: Database) => void;
};

export const ADMIN = ["admin@meetinghub.com", "Admin123!"] as const;
export const USER = ["user@meetinghub.com", "User123!"] as const;

/** A fresh browser: empty storage, the seed data from data/db.json, and a clock you can move. */
export function createApp(storage: KeyValueStorage = memoryStorage()): TestApp {
  let now: Date | undefined;
  const api = createApi({
    storage,
    now: () => now ?? new Date(),
    // Tests have no canvas; the real encoder shrinks the photo, this one keeps the idea.
    encodeImage: async (file) => `data:image/jpeg;base64,${btoa(`stub-${file.size}`)}`,
    hashIterations: 1_000,
  });
  const app: TestApp = {
    api,
    storage,
    setNow: (date) => void (now = date),
    async call(method, path, options = {}) {
      const url = new URL(path, "http://local");
      for (const [key, value] of Object.entries(options.query ?? {})) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
      const response = await api.request(method, `${url.pathname}${url.search}`, { json: options.json, body: options.body });
      const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer());
      let body: any = text; // eslint-disable-line @typescript-eslint/no-explicit-any -- tests read arbitrary shapes
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        // Not JSON (for example a CSV export): keep the raw text.
      }
      return { status: response.status, body, headers: response.headers };
    },
    async signIn(email, password) {
      const response = await app.call("POST", "/api/v1/auth/login", { json: { email, password } });
      if (response.status !== 200) throw new Error(`sign-in failed: ${JSON.stringify(response.body)}`);
    },
    signOut: () => storage.remove("meetinghub_session"),
    data: () => Database.open(storage),
    commit: (db) => db.save(),
  };
  return app;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** An ISO timestamp for `hour`:`minute` Bangkok time, `daysAhead` days from today. */
export function slot(daysAhead: number, hour: number, minute = 0) {
  const base = new Date(Date.now() + daysAhead * 86_400_000 + 7 * 3_600_000);
  return `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(base.getUTCDate())}T${pad(hour)}:${pad(minute)}:00+07:00`;
}

export const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000);

/** Insert a booking directly, bypassing the booking rules. */
export function insertBooking(app: TestApp, booking: Partial<BookingRec> & Pick<BookingRec, "room_id" | "organizer_id" | "starts_at" | "ends_at">) {
  const db = app.data();
  const row: BookingRec = {
    id: db.nextId(db.data.bookings),
    title: "Direct booking",
    description: null,
    attendee_count: 2,
    status: "CONFIRMED",
    recurrence_rule: null,
    checked_in_at: null,
    series_id: null,
    decision_note: null,
    check_in_reminder_sent: false,
    participants: [],
    ...booking,
  };
  db.data.bookings.push(row);
  app.commit(db);
  return row;
}

export const roomId = (app: TestApp, name: string) => app.data().data.rooms.find((room) => room.name === name)!.id;
export const userId = (app: TestApp, email: string) => app.data().data.users.find((user) => user.email === email)!.id;
export { DATA_KEY };
