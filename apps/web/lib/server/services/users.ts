import { randomBytes } from "node:crypto";

import type { Prisma, User } from "@prisma/client";

import { db, isUniqueViolation } from "../db";
import { AppError } from "../errors";
import { hashPassword, verifyPassword } from "../security";
import type { UserCreate, UserUpdate } from "../validation";
import { notify, userIdsWithRoles } from "./notifications";

const token = (bytes: number) => randomBytes(bytes).toString("base64url");

// Verified when the email is unknown so response time does not reveal which accounts exist.
let dummyHash: Promise<string> | undefined;
const dummyPasswordHash = () => (dummyHash ??= hashPassword(token(16)));

export async function authenticate(email: string, password: string): Promise<User | null> {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) {
    await verifyPassword(password, await dummyPasswordHash());
    return null;
  }
  if (!(await verifyPassword(password, user.passwordHash)) || !user.isActive) return null;
  return user;
}

export async function getUser(userId: number) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found");
  return user;
}

export function listUsers(limit: number, offset: number) {
  return db.user.findMany({ orderBy: [{ fullName: "asc" }, { id: "asc" }], take: limit, skip: offset });
}

export async function searchDirectory(query: string, limit = 10) {
  const term = query.trim();
  if (!term) return [];
  return db.user.findMany({
    where: {
      isActive: true,
      OR: [
        { fullName: { contains: term, mode: "insensitive" } },
        { email: { contains: term, mode: "insensitive" } },
      ],
    },
    orderBy: { fullName: "asc" },
    take: limit,
  });
}

export async function createUser(actor: User, payload: UserCreate) {
  const email = payload.email.toLowerCase();
  const password = `Welcome${token(8)}!A1`;
  const passwordHash = await hashPassword(password);
  try {
    const user = await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          fullName: payload.full_name,
          department: payload.department ?? null,
          team: payload.team ?? null,
          role: payload.role,
          passwordHash,
          mustChangePassword: true,
        },
      });
      await tx.auditLog.create({
        data: { userId: actor.id, action: "CREATE", entity: "User", entityId: String(created.id) },
      });
      return created;
    });
    return { user, password };
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError(409, "EMAIL_TAKEN", "Email already exists", "email");
    throw error;
  }
}

export async function updateUser(actor: User, userId: number, payload: UserUpdate) {
  const user = await getUser(userId);
  const data: Prisma.UserUpdateInput = {};
  if (payload.full_name !== undefined) data.fullName = payload.full_name;
  if (payload.department !== undefined) data.department = payload.department;
  if (payload.team !== undefined) data.team = payload.team;
  if (payload.role !== undefined) data.role = payload.role;
  if (payload.is_active !== undefined) data.isActive = payload.is_active;
  if (user.id === actor.id) {
    // Keeps at least one working administrator: nobody can lock themselves out.
    if (payload.is_active === false) {
      throw new AppError(409, "CANNOT_MODIFY_SELF", "You cannot deactivate your own account", "is_active");
    }
    if (payload.role !== undefined && payload.role !== user.role) {
      throw new AppError(409, "CANNOT_MODIFY_SELF", "You cannot change your own role", "role");
    }
  }
  const fields = Object.entries(payload)
    .filter(([, value]) => value !== undefined)
    .map(([name]) => name)
    .sort();
  return db.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id: user.id }, data });
    await tx.auditLog.create({
      data: { userId: actor.id, action: "UPDATE", entity: "User", entityId: String(user.id), details: { fields } },
    });
    return updated;
  });
}

export async function resetPassword(actor: User, userId: number) {
  const user = await getUser(userId);
  const temporary = `Reset${token(9)}!A1`;
  const passwordHash = await hashPassword(temporary);
  await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: true, tokenVersion: { increment: 1 } },
    }),
    db.auditLog.create({
      data: { userId: actor.id, action: "RESET_PASSWORD", entity: "User", entityId: String(user.id) },
    }),
  ]);
  return temporary;
}

export async function changePassword(user: User, currentPassword: string, newPassword: string) {
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new AppError(400, "INVALID_CURRENT_PASSWORD", "Current password is incorrect", "current_password");
  }
  if (newPassword === currentPassword) {
    throw new AppError(400, "PASSWORD_UNCHANGED", "New password must be different from the current one", "new_password");
  }
  const passwordHash = await hashPassword(newPassword);
  const [updated] = await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false, tokenVersion: { increment: 1 } },
    }),
    db.auditLog.create({
      data: { userId: user.id, action: "CHANGE_PASSWORD", entity: "User", entityId: String(user.id) },
    }),
  ]);
  return updated;
}

/**
 * Ask the administrators to reset a password. Silent when the account does not exist.
 *
 * There is no outbound email, so a reset link cannot be delivered to the user directly; an
 * administrator issues a temporary password from the admin page instead.
 */
export async function requestPasswordReset(email: string) {
  const user = await db.user.findFirst({ where: { email: email.toLowerCase(), isActive: true } });
  if (!user) return;
  const title = "Password reset requested";
  const message = `${user.fullName} (${user.email}) cannot sign in and asked for a password reset.`;
  await db.$transaction(async (tx) => {
    const waiting = new Set(
      (
        await tx.notification.findMany({
          where: { title, message, isRead: false },
          select: { userId: true },
        })
      ).map((item) => item.userId),
    );
    // Do not pile up duplicates for an admin who has not seen the earlier request yet.
    const admins = (await userIdsWithRoles(tx, "ADMIN")).filter((admin) => !waiting.has(admin));
    await notify(tx, admins, title, message, "/admin");
    await tx.auditLog.create({
      data: { userId: user.id, action: "REQUEST_PASSWORD_RESET", entity: "User", entityId: String(user.id) },
    });
  });
}

export async function revokeSessions(user: User) {
  await db.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });
}
