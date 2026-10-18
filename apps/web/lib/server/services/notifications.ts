import type { Role, User } from "@prisma/client";

import { type Db, db } from "../db";
import { AppError } from "../errors";

// Callers pass their own transaction and commit notifications together with the change they
// describe, so a notification never exists for something that was rolled back.

export async function notify(client: Db, userIds: Iterable<number>, title: string, message: string, link: string | null = null) {
  const recipients = [...new Set(userIds)];
  if (recipients.length === 0) return;
  await client.notification.createMany({ data: recipients.map((userId) => ({ userId, title, message, link })) });
}

export async function userIdsForEmails(client: Db, emails: Iterable<string>) {
  const wanted = [...new Set([...emails].map((email) => email.toLowerCase()))];
  if (wanted.length === 0) return [];
  const users = await client.user.findMany({ where: { isActive: true, email: { in: wanted } }, select: { id: true } });
  return users.map((user) => user.id);
}

export async function userIdsWithRoles(client: Db, ...roles: Role[]) {
  const users = await client.user.findMany({ where: { isActive: true, role: { in: roles } }, select: { id: true } });
  return users.map((user) => user.id);
}

export async function listForUser(user: User, limit: number) {
  const [items, unread] = await Promise.all([
    db.notification.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    }),
    db.notification.count({ where: { userId: user.id, isRead: false } }),
  ]);
  return { items, unread };
}

export async function markRead(user: User, notificationId: number) {
  const item = await db.notification.findUnique({ where: { id: notificationId } });
  // Someone else's notification is reported as missing so ids cannot be probed.
  if (!item || item.userId !== user.id) throw new AppError(404, "NOTIFICATION_NOT_FOUND", "Notification not found");
  return db.notification.update({ where: { id: item.id }, data: { isRead: true } });
}

export async function markAllRead(user: User) {
  await db.notification.updateMany({ where: { userId: user.id, isRead: false }, data: { isRead: true } });
}
