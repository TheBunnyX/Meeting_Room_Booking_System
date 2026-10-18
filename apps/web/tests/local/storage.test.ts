import { describe, expect, it } from "vitest";

import seed from "../../data/db.json";
import { type KeyValueStorage, memoryStorage } from "../../lib/local/storage";
import { USER, createApp, roomId, slot } from "../support/local";

const booking = (room: number) => ({ room_id: room, title: "Planning", attendee_count: 2, starts_at: slot(3, 10), ends_at: slot(3, 11) });

describe("browser storage", () => {
  it("starts from data/db.json and writes nothing until something changes", async () => {
    const storage = memoryStorage();
    const app = createApp(storage);
    await app.signIn(...USER);
    expect((await app.call("GET", "/api/v1/rooms")).body).toHaveLength(seed.rooms.length);
    expect(storage.get("meetinghub_db_v1")).toBeNull();
    await app.call("POST", "/api/v1/bookings", { json: booking(roomId(app, "Studio 01")) });
    expect(storage.get("meetinghub_db_v1")).not.toBeNull();
  });

  it("keeps data across a reload and shares it between tabs of the same browser", async () => {
    const storage = memoryStorage();
    const first = createApp(storage);
    await first.signIn(...USER);
    const created = await first.call("POST", "/api/v1/bookings", { json: booking(roomId(first, "Studio 01")) });

    // A reload or a second tab is a new API instance reading the same storage, and it is still signed in.
    const second = createApp(storage);
    const mine = await second.call("GET", "/api/v1/bookings/my");
    expect(mine.body.map((item: { id: number }) => item.id)).toEqual([created.body.id]);
    // Both tabs see each other's bookings and refuse to double-book.
    expect((await second.call("POST", "/api/v1/bookings", { json: booking(roomId(second, "Studio 01")) })).status).toBe(409);
  });

  it("starts again from the seed when the stored data is damaged", async () => {
    const storage = memoryStorage({ meetinghub_db_v1: "{not json" });
    const app = createApp(storage);
    await app.signIn(...USER);
    expect((await app.call("GET", "/api/v1/rooms")).body).toHaveLength(seed.rooms.length);
  });

  it("explains when the browser storage is full, and keeps what was stored before", async () => {
    const backing = memoryStorage();
    let full = false;
    const storage: KeyValueStorage = {
      get: (key) => backing.get(key),
      remove: (key) => backing.remove(key),
      set: (key, value) => {
        if (full && key === "meetinghub_db_v1") throw new DOMException("quota", "QuotaExceededError");
        backing.set(key, value);
      },
    };
    const app = createApp(storage);
    await app.signIn(...USER);
    const first = await app.call("POST", "/api/v1/bookings", { json: booking(roomId(app, "Studio 01")) });
    expect(first.status).toBe(201);
    full = true;
    const second = await app.call("POST", "/api/v1/bookings", { json: { ...booking(roomId(app, "Focus Room")), attendee_count: 1 } });
    expect(second.status).toBe(507);
    expect(second.body.error.code).toBe("STORAGE_FULL");
    expect(app.data().data.bookings).toHaveLength(1);
  });

  it("never exposes password hashes through the API", async () => {
    const app = createApp();
    await app.signIn(...USER);
    const everything = JSON.stringify([
      (await app.call("GET", "/api/v1/auth/me")).body,
      (await app.call("GET", "/api/v1/participants/search", { query: { q: "meeting" } })).body,
    ]);
    expect(everything).not.toMatch(/pbkdf2|password_hash/);
  });
});
