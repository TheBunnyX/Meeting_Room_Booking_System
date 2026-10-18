import { beforeEach, describe, expect, it } from "vitest";

import { POST as changePassword } from "@/app/api/v1/auth/change-password/route";
import { POST as forgotPassword } from "@/app/api/v1/auth/forgot-password/route";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as logout } from "@/app/api/v1/auth/logout/route";
import { GET as me } from "@/app/api/v1/auth/me/route";
import { GET as listRooms } from "@/app/api/v1/rooms/route";
import { PATCH as updateUser } from "@/app/api/v1/users/[userId]/route";
import { POST as resetPassword } from "@/app/api/v1/users/[userId]/reset-password/route";
import { GET as listUsers, POST as createUser } from "@/app/api/v1/users/route";
import { db } from "@/lib/server/db";

import { call, createUser as makeUser, resetDatabase, signIn } from "../support/app";

beforeEach(resetDatabase);

describe("sign-in", () => {
  it("starts a cookie session and returns the user without secrets", async () => {
    const response = await call(login, "/api/v1/auth/login", {
      method: "POST",
      json: { email: "Admin@MeetingHub.com", password: "Admin123!" },
    });
    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ email: "admin@meetinghub.com", role: "ADMIN" });
    expect(JSON.stringify(response.body)).not.toContain("password_hash");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("meetinghub_session=");
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
  });

  it("rejects wrong credentials with one message for unknown and known accounts", async () => {
    const wrong = await call(login, "/api/v1/auth/login", {
      method: "POST",
      json: { email: "admin@meetinghub.com", password: "nope" },
    });
    const unknown = await call(login, "/api/v1/auth/login", {
      method: "POST",
      json: { email: "ghost@meetinghub.com", password: "nope" },
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("validates the body", async () => {
    const response = await call(login, "/api/v1/auth/login", {
      method: "POST",
      json: { email: "not-an-email", password: "x" },
    });
    expect(response.status).toBe(422);
    expect(response.body.error).toMatchObject({ code: "VALIDATION_ERROR", field: "email" });
  });

  it("rejects an inactive account", async () => {
    await makeUser("gone@meetinghub.com", "USER", "Passw0rd!x", { isActive: false });
    const response = await call(login, "/api/v1/auth/login", {
      method: "POST",
      json: { email: "gone@meetinghub.com", password: "Passw0rd!x" },
    });
    expect(response.status).toBe(401);
  });

  it("locks out after repeated failures, counted in the database per client", async () => {
    const attempt = (password: string, address: string) =>
      call(login, "/api/v1/auth/login", {
        method: "POST",
        json: { email: "user@meetinghub.com", password },
        headers: { "x-forwarded-for": address },
      });
    for (let i = 0; i < 5; i += 1) expect((await attempt("wrong", "9.9.9.9")).status).toBe(401);
    const blocked = await attempt("User123!", "9.9.9.9");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("TOO_MANY_ATTEMPTS");
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    // A different client address is counted separately.
    expect((await attempt("User123!", "8.8.8.8")).status).toBe(200);
  });
});

describe("session", () => {
  it("requires authentication", async () => {
    const response = await call(me, "/api/v1/auth/me");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("accepts a bearer token and rejects a tampered one", async () => {
    const response = await call(login, "/api/v1/auth/login", {
      method: "POST",
      json: { email: "user@meetinghub.com", password: "User123!" },
    });
    const token = response.body.access_token as string;
    expect((await call(me, "/api/v1/auth/me", { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await call(me, "/api/v1/auth/me", { headers: { authorization: `Bearer ${token}x` } })).status).toBe(401);
  });

  it("revokes the session on sign-out", async () => {
    const cookie = await signIn(login, "user@meetinghub.com", "User123!");
    expect((await call(me, "/api/v1/auth/me", { cookie })).status).toBe(200);
    expect((await call(logout, "/api/v1/auth/logout", { method: "POST", cookie })).status).toBe(200);
    expect((await call(me, "/api/v1/auth/me", { cookie })).status).toBe(401);
  });

  it("refuses cookie-authenticated writes from another origin", async () => {
    const cookie = await signIn(login, "user@meetinghub.com", "User123!");
    const foreign = await call(logout, "/api/v1/auth/logout", {
      method: "POST",
      cookie,
      headers: { origin: "https://evil.example" },
    });
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.code).toBe("FORBIDDEN_ORIGIN");
    const own = await call(logout, "/api/v1/auth/logout", {
      method: "POST",
      cookie,
      headers: { origin: "http://localhost:3000" },
    });
    expect(own.status).toBe(200);
  });
});

describe("passwords", () => {
  it("forces a temporary password to be replaced before anything else works", async () => {
    await makeUser("temp@meetinghub.com", "USER", "Temp0rary!x", { mustChangePassword: true });
    const cookie = await signIn(login, "temp@meetinghub.com", "Temp0rary!x");
    expect((await call(me, "/api/v1/auth/me", { cookie })).body.must_change_password).toBe(true);
    const blocked = await call(listRooms, "/api/v1/rooms", { cookie });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    const changed = await call(changePassword, "/api/v1/auth/change-password", {
      method: "POST",
      cookie,
      json: { current_password: "Temp0rary!x", new_password: "Brand-new-1" },
    });
    expect(changed.status).toBe(200);
    const fresh = (changed.headers.get("set-cookie") ?? "").split(";")[0];
    expect((await call(listRooms, "/api/v1/rooms", { cookie: fresh })).status).toBe(200);
    // The old session was revoked by the change.
    expect((await call(me, "/api/v1/auth/me", { cookie })).status).toBe(401);
  });

  it("checks the current password and requires a different one", async () => {
    const cookie = await signIn(login, "user@meetinghub.com", "User123!");
    const change = (current_password: string, new_password: string) =>
      call(changePassword, "/api/v1/auth/change-password", { method: "POST", cookie, json: { current_password, new_password } });
    expect((await change("bad", "Another-pass1")).body.error.code).toBe("INVALID_CURRENT_PASSWORD");
    expect((await change("User123!", "User123!")).body.error.code).toBe("PASSWORD_UNCHANGED");
    expect((await change("User123!", "short")).status).toBe(422);
  });

  it("answers forgot-password the same way for any address and notifies admins once", async () => {
    const ask = (email: string) => call(forgotPassword, "/api/v1/auth/forgot-password", { method: "POST", json: { email } });
    const known = await ask("user@meetinghub.com");
    const unknown = await ask("ghost@meetinghub.com");
    expect(known.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    await ask("user@meetinghub.com");
    expect(await db.notification.count({ where: { title: "Password reset requested" } })).toBe(1);
  });

  it("rate limits forgot-password", async () => {
    const send = () =>
      call(forgotPassword, "/api/v1/auth/forgot-password", {
        method: "POST",
        json: { email: "user@meetinghub.com" },
        headers: { "x-forwarded-for": "7.7.7.7" },
      });
    for (let i = 0; i < 3; i += 1) expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
  });
});

describe("user administration", () => {
  it("is limited to administrators", async () => {
    const userCookie = await signIn(login, "user@meetinghub.com", "User123!");
    expect((await call(listUsers, "/api/v1/users", { cookie: userCookie })).status).toBe(403);
    expect((await call(listUsers, "/api/v1/users")).status).toBe(401);
    await makeUser("fac@meetinghub.com", "FACILITY_ADMIN");
    const facCookie = await signIn(login, "fac@meetinghub.com", "Passw0rd!x");
    expect((await call(listUsers, "/api/v1/users", { cookie: facCookie })).status).toBe(403);
  });

  it("creates a user with a temporary password and rejects duplicates", async () => {
    const cookie = await signIn(login, "admin@meetinghub.com", "Admin123!");
    const created = await call(createUser, "/api/v1/users", {
      method: "POST",
      cookie,
      json: { email: "New.Person@meetinghub.com", full_name: "New Person", role: "USER" },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ email: "new.person@meetinghub.com", must_change_password: true });
    expect(created.body.temporary_password).toMatch(/^Welcome/);
    expect(created.body).not.toHaveProperty("password_hash");
    const again = await call(createUser, "/api/v1/users", {
      method: "POST",
      cookie,
      json: { email: "new.person@meetinghub.com", full_name: "Other" },
    });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: "EMAIL_TAKEN", field: "email" });
    const signedIn = await call(login, "/api/v1/auth/login", {
      method: "POST",
      json: { email: "new.person@meetinghub.com", password: created.body.temporary_password },
    });
    expect(signedIn.status).toBe(200);
  });

  it("stops administrators locking themselves out and ignores unknown fields", async () => {
    const cookie = await signIn(login, "admin@meetinghub.com", "Admin123!");
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@meetinghub.com" } });
    const patch = (userId: number, json: unknown) => call(updateUser, "/x", { method: "PATCH", cookie, params: { userId }, json });
    expect((await patch(admin.id, { is_active: false })).body.error.code).toBe("CANNOT_MODIFY_SELF");
    expect((await patch(admin.id, { role: "USER" })).body.error.code).toBe("CANNOT_MODIFY_SELF");
    const ok = await patch(admin.id, { department: "IT", password_hash: "hacked" });
    expect(ok.status).toBe(200);
    expect(ok.body.department).toBe("IT");
    expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).passwordHash).not.toBe("hacked");
    expect((await patch(9999, { department: "IT" })).status).toBe(404);
  });

  it("resets a password and revokes the sessions of that user", async () => {
    const adminCookie = await signIn(login, "admin@meetinghub.com", "Admin123!");
    const userCookie = await signIn(login, "user@meetinghub.com", "User123!");
    const user = await db.user.findUniqueOrThrow({ where: { email: "user@meetinghub.com" } });
    const reset = await call(resetPassword, "/x", { method: "POST", cookie: adminCookie, params: { userId: user.id } });
    expect(reset.status).toBe(200);
    expect(reset.body.temporary_password).toMatch(/^Reset/);
    expect((await call(me, "/api/v1/auth/me", { cookie: userCookie })).status).toBe(401);
    const audit = await db.auditLog.findFirst({ where: { action: "RESET_PASSWORD" } });
    expect(audit?.entityId).toBe(String(user.id));
  });
});
