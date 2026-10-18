import { beforeEach, describe, expect, it } from "vitest";

import { ADMIN, USER, type TestApp, createApp, userId } from "../support/local";

let app: TestApp;

beforeEach(() => {
  app = createApp();
});

const login = (email: string, password: string) => app.call("POST", "/api/v1/auth/login", { json: { email, password } });

describe("sign-in", () => {
  it("starts a session and returns the user without secrets", async () => {
    const response = await login("Admin@MeetingHub.com", "Admin123!");
    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ email: "admin@meetinghub.com", role: "ADMIN" });
    expect(JSON.stringify(response.body)).not.toContain("password_hash");
    expect((await app.call("GET", "/api/v1/auth/me")).body.email).toBe("admin@meetinghub.com");
  });

  it("gives one answer for a wrong password and an unknown email", async () => {
    const wrong = await login("admin@meetinghub.com", "nope");
    const unknown = await login("ghost@meetinghub.com", "nope");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("validates the body", async () => {
    const response = await login("not-an-email", "x");
    expect(response.status).toBe(422);
    expect(response.body.error).toMatchObject({ code: "VALIDATION_ERROR", field: "email" });
  });

  it("locks out after repeated failures and unlocks after the window", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) expect((await login(USER[0], "wrong")).status).toBe(401);
    const blocked = await login(...USER);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("TOO_MANY_ATTEMPTS");
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    // Other accounts are counted separately, and the lock ends after the 15 minute window.
    expect((await login(...ADMIN)).status).toBe(200);
    app.setNow(new Date(Date.now() + 16 * 60_000));
    expect((await login(...USER)).status).toBe(200);
  });

  it("rejects an inactive account", async () => {
    const db = app.data();
    db.data.users.find((user) => user.email === USER[0])!.is_active = false;
    app.commit(db);
    expect((await login(...USER)).status).toBe(401);
  });
});

describe("session", () => {
  it("requires sign-in", async () => {
    const response = await app.call("GET", "/api/v1/auth/me");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
    expect((await app.call("GET", "/api/v1/rooms")).status).toBe(401);
  });

  it("ends on sign-out and when it expires", async () => {
    await app.signIn(...USER);
    expect((await app.call("POST", "/api/v1/auth/logout")).status).toBe(200);
    expect((await app.call("GET", "/api/v1/auth/me")).status).toBe(401);

    await app.signIn(...USER);
    app.setNow(new Date(Date.now() + 9 * 3_600_000));
    expect((await app.call("GET", "/api/v1/auth/me")).status).toBe(401);
  });

  it("is revoked everywhere when the password changes", async () => {
    await app.signIn(...USER);
    const stale = app.storage.get("meetinghub_session")!;
    const changed = await app.call("POST", "/api/v1/auth/change-password", {
      json: { current_password: USER[1], new_password: "Brand-new-1" },
    });
    expect(changed.status).toBe(200);
    expect((await app.call("GET", "/api/v1/auth/me")).status).toBe(200);
    app.storage.set("meetinghub_session", stale);
    expect((await app.call("GET", "/api/v1/auth/me")).status).toBe(401);
    expect((await login(USER[0], "Brand-new-1")).status).toBe(200);
  });

  it("returns 404 for unknown paths and 405 for the wrong method", async () => {
    expect((await app.call("GET", "/api/v1/nothing")).status).toBe(404);
    expect((await app.call("DELETE", "/api/v1/auth/login")).status).toBe(405);
  });
});

describe("passwords", () => {
  it("forces a temporary password to be replaced before anything else works", async () => {
    await app.signIn(...ADMIN);
    const created = await app.call("POST", "/api/v1/users", { json: { email: "New.Person@meetinghub.com", full_name: "New Person" } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ email: "new.person@meetinghub.com", must_change_password: true });
    expect(created.body.temporary_password).toMatch(/^Welcome/);

    await app.signIn("new.person@meetinghub.com", created.body.temporary_password);
    expect((await app.call("GET", "/api/v1/auth/me")).body.must_change_password).toBe(true);
    const blocked = await app.call("GET", "/api/v1/rooms");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    const changed = await app.call("POST", "/api/v1/auth/change-password", {
      json: { current_password: created.body.temporary_password, new_password: "Brand-new-1" },
    });
    expect(changed.body.user.must_change_password).toBe(false);
    expect((await app.call("GET", "/api/v1/rooms")).status).toBe(200);
  });

  it("checks the current password and requires a different one", async () => {
    await app.signIn(...USER);
    const change = (current_password: string, new_password: string) =>
      app.call("POST", "/api/v1/auth/change-password", { json: { current_password, new_password } });
    expect((await change("bad", "Another-pass1")).body.error.code).toBe("INVALID_CURRENT_PASSWORD");
    expect((await change(USER[1], USER[1])).body.error.code).toBe("PASSWORD_UNCHANGED");
    expect((await change(USER[1], "short")).status).toBe(422);
  });

  it("answers forgot-password the same for any address and notifies admins once", async () => {
    const ask = (email: string) => app.call("POST", "/api/v1/auth/forgot-password", { json: { email } });
    const known = await ask(USER[0]);
    const unknown = await ask("ghost@meetinghub.com");
    expect(known.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    await ask(USER[0]);
    expect(app.data().data.notifications.filter((item) => item.title === "Password reset requested")).toHaveLength(1);
    // The fourth request inside the window is refused.
    expect((await ask(USER[0])).status).toBe(429);
  });
});

describe("user administration", () => {
  it("is limited to administrators", async () => {
    expect((await app.call("GET", "/api/v1/users")).status).toBe(401);
    await app.signIn(...USER);
    expect((await app.call("GET", "/api/v1/users")).status).toBe(403);
    await app.signIn(...ADMIN);
    const list = await app.call("GET", "/api/v1/users");
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain("password_hash");
  });

  it("rejects duplicate emails", async () => {
    await app.signIn(...ADMIN);
    const again = await app.call("POST", "/api/v1/users", { json: { email: USER[0], full_name: "Other" } });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: "EMAIL_TAKEN", field: "email" });
  });

  it("stops administrators locking themselves out and ignores unknown fields", async () => {
    await app.signIn(...ADMIN);
    const adminId = userId(app, ADMIN[0]);
    const patch = (id: number, json: unknown) => app.call("PATCH", `/api/v1/users/${id}`, { json });
    expect((await patch(adminId, { is_active: false })).body.error.code).toBe("CANNOT_MODIFY_SELF");
    expect((await patch(adminId, { role: "USER" })).body.error.code).toBe("CANNOT_MODIFY_SELF");
    const ok = await patch(adminId, { department: "IT", password_hash: "hacked" });
    expect(ok.body.department).toBe("IT");
    expect(app.data().user(adminId)!.password_hash).not.toBe("hacked");
    expect((await patch(9999, { department: "IT" })).status).toBe(404);
  });

  it("resets a password and revokes the sessions of that user", async () => {
    await app.signIn(...USER);
    const userSession = app.storage.get("meetinghub_session")!;
    await app.signIn(...ADMIN);
    const reset = await app.call("POST", `/api/v1/users/${userId(app, USER[0])}/reset-password`);
    expect(reset.body.temporary_password).toMatch(/^Reset/);
    app.storage.set("meetinghub_session", userSession);
    expect((await app.call("GET", "/api/v1/auth/me")).status).toBe(401);
    expect(app.data().data.audit_logs.some((log) => log.action === "RESET_PASSWORD")).toBe(true);
  });

  it("finds colleagues by name or email for invitations", async () => {
    await app.signIn(...USER);
    const found = await app.call("GET", "/api/v1/participants/search", { query: { q: "admin" } });
    expect(found.body).toEqual([{ id: userId(app, ADMIN[0]), email: ADMIN[0], full_name: "System Administrator" }]);
    expect((await app.call("GET", "/api/v1/participants/search", { query: { q: "  " } })).body).toEqual([]);
  });
});
