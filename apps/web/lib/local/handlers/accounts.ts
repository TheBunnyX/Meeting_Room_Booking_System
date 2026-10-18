import type { UserRec } from "../database";
import { LocalApiError } from "../errors";
import { hashPassword, randomToken, verifyPassword } from "../password";
import type { UserCreate, UserUpdate } from "../validation";
import {
  type Ctx,
  SESSION_MINUTES,
  audit,
  authenticated,
  iso,
  notify,
  requireRoles,
  userIdsWithRoles,
  userRead,
} from "./shared";

// Failed sign-ins and password-reset requests are counted per email in a sliding window. Everything here
// runs in the visitor's own browser, so this is a courtesy against typing mistakes, not a security boundary.
const LOGIN_MAX_ATTEMPTS = 5;
const FORGOT_MAX_REQUESTS = 3;
const WINDOW_SECONDS = 15 * 60;

function retryAfter(ctx: Ctx, bucket: string, key: string, max: number) {
  const since = ctx.now.getTime() - WINDOW_SECONDS * 1000;
  const events = ctx.db.data.rate_events
    .filter((event) => event.bucket === bucket && event.key === key && new Date(event.at).getTime() > since)
    .sort((a, b) => a.at.localeCompare(b.at));
  if (events.length < max) return 0;
  const oldest = new Date(events[0].at).getTime();
  return Math.max(1, Math.ceil(WINDOW_SECONDS - (ctx.now.getTime() - oldest) / 1000));
}

function recordEvent(ctx: Ctx, bucket: string, key: string) {
  const since = ctx.now.getTime() - WINDOW_SECONDS * 1000;
  // Expired events are useless; dropping them keeps the stored data small.
  ctx.db.data.rate_events = ctx.db.data.rate_events.filter((event) => new Date(event.at).getTime() > since);
  ctx.db.data.rate_events.push({ bucket, key, at: iso(ctx.now) });
}

const tooMany = (message: string, wait: number) =>
  new LocalApiError(429, "TOO_MANY_ATTEMPTS", message, null, { "Retry-After": String(wait) });

// Checked when the email is unknown so the time taken does not reveal which accounts exist.
let dummyHash: Promise<string> | undefined;

function startSession(ctx: Ctx, user: UserRec) {
  const token = randomToken(24);
  ctx.setSession({
    user_id: user.id,
    token_version: user.token_version,
    expires_at: iso(new Date(ctx.now.getTime() + SESSION_MINUTES * 60_000)),
  });
  return { access_token: token, token_type: "bearer", user: userRead(user) };
}

export async function login(ctx: Ctx, body: { email: string; password: string }) {
  const key = body.email;
  const wait = retryAfter(ctx, "login", key, LOGIN_MAX_ATTEMPTS);
  if (wait) throw tooMany("Too many failed sign-in attempts. Try again later.", wait);
  const user = ctx.db.data.users.find((candidate) => candidate.email === body.email);
  let valid = false;
  if (user) valid = (await verifyPassword(body.password, user.password_hash)) && user.is_active;
  else await verifyPassword(body.password, await (dummyHash ??= hashPassword(randomToken(16), ctx.hashIterations)));
  if (!user || !valid) {
    recordEvent(ctx, "login", key);
    throw new LocalApiError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }
  ctx.db.data.rate_events = ctx.db.data.rate_events.filter((event) => !(event.bucket === "login" && event.key === key));
  return startSession(ctx, user);
}

export function forgotPassword(ctx: Ctx, body: { email: string }) {
  const wait = retryAfter(ctx, "forgot", "any", FORGOT_MAX_REQUESTS);
  if (wait) throw tooMany("Too many reset requests. Try again later.", wait);
  // Every request counts, so the form cannot be used to flood the administrators.
  recordEvent(ctx, "forgot", "any");
  const user = ctx.db.data.users.find((candidate) => candidate.email === body.email && candidate.is_active);
  if (user) {
    const title = "Password reset requested";
    const message = `${user.full_name} (${user.email}) cannot sign in and asked for a password reset.`;
    const waiting = new Set(
      ctx.db.data.notifications
        .filter((item) => item.title === title && item.message === message && !item.is_read)
        .map((item) => item.user_id),
    );
    // Do not pile up duplicates for an admin who has not seen the earlier request yet.
    notify(ctx, userIdsWithRoles(ctx, "ADMIN").filter((admin) => !waiting.has(admin)), title, message, "/admin");
    audit(ctx, user.id, "REQUEST_PASSWORD_RESET", "User", user.id);
  }
  // The same answer whether or not the account exists, so emails cannot be enumerated.
  return { message: "If that account exists, an administrator has been asked to issue a temporary password." };
}

export function logout(ctx: Ctx) {
  const user = authenticated(ctx);
  user.token_version += 1;
  ctx.setSession(null);
  return { message: "Signed out." };
}

export const me = (ctx: Ctx) => userRead(authenticated(ctx));

export async function changePassword(ctx: Ctx, body: { current_password: string; new_password: string }) {
  const user = authenticated(ctx);
  if (!(await verifyPassword(body.current_password, user.password_hash))) {
    throw new LocalApiError(400, "INVALID_CURRENT_PASSWORD", "Current password is incorrect", "current_password");
  }
  if (body.new_password === body.current_password) {
    throw new LocalApiError(400, "PASSWORD_UNCHANGED", "New password must be different from the current one", "new_password");
  }
  user.password_hash = await hashPassword(body.new_password, ctx.hashIterations);
  user.must_change_password = false;
  user.token_version += 1;
  audit(ctx, user.id, "CHANGE_PASSWORD", "User", user.id);
  // Changing the password revokes every existing session, so start a fresh one for this browser.
  return startSession(ctx, user);
}

export function searchDirectory(ctx: Ctx, query: string) {
  const term = query.trim().toLowerCase();
  if (!term) return [];
  return ctx.db.data.users
    .filter((user) => user.is_active && (user.full_name.toLowerCase().includes(term) || user.email.includes(term)))
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
    .slice(0, 10)
    .map((user) => ({ id: user.id, email: user.email, full_name: user.full_name }));
}

export function listUsers(ctx: Ctx, limit: number, offset: number) {
  requireRoles(ctx, "ADMIN");
  return [...ctx.db.data.users]
    .sort((a, b) => a.full_name.localeCompare(b.full_name) || a.id - b.id)
    .slice(offset, offset + limit)
    .map(userRead);
}

export async function createUser(ctx: Ctx, payload: UserCreate) {
  const actor = requireRoles(ctx, "ADMIN");
  if (ctx.db.data.users.some((user) => user.email === payload.email)) {
    throw new LocalApiError(409, "EMAIL_TAKEN", "Email already exists", "email");
  }
  const password = `Welcome${randomToken(6)}!A1`;
  const user: UserRec = {
    id: ctx.db.nextId(ctx.db.data.users),
    email: payload.email,
    full_name: payload.full_name,
    department: payload.department ?? null,
    team: payload.team ?? null,
    role: payload.role,
    is_active: true,
    must_change_password: true,
    password_hash: await hashPassword(password, ctx.hashIterations),
    token_version: 0,
  };
  ctx.db.data.users.push(user);
  audit(ctx, actor.id, "CREATE", "User", user.id);
  return { ...userRead(user), temporary_password: password };
}

export function updateUser(ctx: Ctx, userId: number, payload: UserUpdate) {
  const actor = requireRoles(ctx, "ADMIN");
  const user = ctx.db.user(userId);
  if (!user) throw new LocalApiError(404, "USER_NOT_FOUND", "User not found");
  if (user.id === actor.id) {
    // Keeps at least one working administrator: nobody can lock themselves out.
    if (payload.is_active === false) {
      throw new LocalApiError(409, "CANNOT_MODIFY_SELF", "You cannot deactivate your own account", "is_active");
    }
    if (payload.role !== undefined && payload.role !== user.role) {
      throw new LocalApiError(409, "CANNOT_MODIFY_SELF", "You cannot change your own role", "role");
    }
  }
  if (payload.full_name !== undefined) user.full_name = payload.full_name;
  if (payload.department !== undefined) user.department = payload.department;
  if (payload.team !== undefined) user.team = payload.team;
  if (payload.role !== undefined) user.role = payload.role;
  if (payload.is_active !== undefined) user.is_active = payload.is_active;
  const fields = Object.entries(payload)
    .filter(([, value]) => value !== undefined)
    .map(([name]) => name)
    .sort();
  audit(ctx, actor.id, "UPDATE", "User", user.id, { fields });
  return userRead(user);
}

export async function resetPassword(ctx: Ctx, userId: number) {
  const actor = requireRoles(ctx, "ADMIN");
  const user = ctx.db.user(userId);
  if (!user) throw new LocalApiError(404, "USER_NOT_FOUND", "User not found");
  const temporary = `Reset${randomToken(7)}!A1`;
  user.password_hash = await hashPassword(temporary, ctx.hashIterations);
  user.must_change_password = true;
  user.token_version += 1;
  audit(ctx, actor.id, "RESET_PASSWORD", "User", user.id);
  return {
    temporary_password: temporary,
    message: "Provide this temporary password securely; the user must change it after sign-in.",
  };
}
