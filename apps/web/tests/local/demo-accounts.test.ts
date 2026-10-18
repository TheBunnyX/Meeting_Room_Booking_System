import { describe, expect, it } from "vitest";

import demoAccounts from "../../data/demo-accounts.json";
import seed from "../../data/db.json";
import { DATA_KEY } from "../../lib/local/database";
import { verifyPassword } from "../../lib/local/password";
import { memoryStorage } from "../../lib/local/storage";
import { createApp } from "../support/local";

describe("demo accounts listed on the sign-in page", () => {
  it("are exactly the users of the starting data", () => {
    expect(demoAccounts.map((account) => account.email).sort()).toEqual(seed.users.map((user) => user.email).sort());
    expect(new Set(demoAccounts.map((account) => account.role))).toEqual(new Set(["ADMIN", "FACILITY_ADMIN", "USER"]));
  });

  it("show a password that really signs in, with the role that is listed", async () => {
    for (const account of demoAccounts) {
      const user = seed.users.find((candidate) => candidate.email === account.email)!;
      expect(await verifyPassword(account.password, user.password_hash)).toBe(true);
      expect(user.role).toBe(account.role);
    }
  });

  it("can all be used through the real sign-in route", async () => {
    const app = createApp();
    for (const account of demoAccounts) {
      await app.signIn(account.email, account.password);
      expect((await app.call("GET", "/api/v1/auth/me")).body).toMatchObject({ email: account.email, role: account.role });
    }
  });
});

describe("a browser that stored the data before new demo users existed", () => {
  it("gets the missing users added without losing anything it already has", async () => {
    const oldUsers = seed.users.slice(0, 2).map((user) => ({ ...user, token_version: 0 }));
    const stored = {
      version: 1,
      users: oldUsers,
      facilities: seed.facilities,
      rooms: seed.rooms.map((room) => ({ ...room, name: room.id === 1 ? "Renamed room" : room.name })),
      bookings: [],
      maintenance: [],
      check_ins: [],
      notifications: [],
      audit_logs: [],
      check_in_codes: [],
      rate_events: [],
    };
    const storage = memoryStorage({ [DATA_KEY]: JSON.stringify(stored) });
    const app = createApp(storage);

    const last = demoAccounts[demoAccounts.length - 1];
    await app.signIn(last.email, last.password);
    const db = app.data();
    expect(db.data.users).toHaveLength(seed.users.length);
    expect(new Set(db.data.users.map((user) => user.id)).size).toBe(seed.users.length);
    // The first two users and the edited room are untouched.
    expect(db.data.users.slice(0, 2).map((user) => user.email)).toEqual(oldUsers.map((user) => user.email));
    expect(db.room(1)!.name).toBe("Renamed room");
  });
});
