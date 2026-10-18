import type { PrismaClient, Role } from "@prisma/client";

import { hashPassword } from "../security";

// Demo accounts with well-known passwords. They are only created in development and test, and in
// DEMO_MODE deployments (public demos that reset daily).
const DEMO_USERS: Array<[string, string, string, Role]> = [
  ["admin@meetinghub.com", "System Administrator", "Admin123!", "ADMIN"],
  ["user@meetinghub.com", "MeetingHub User", "User123!", "USER"],
];
const FACILITY_NAMES = ["TV", "Projector", "Whiteboard", "Video Conference", "HDMI"];
const DEMO_ROOMS: Array<[string, string, string, number, string, string[]]> = [
  ["Studio 01", "North House", "02", 8, "/rooms/studio-01.png", ["Video Conference", "Whiteboard"]],
  ["The Library", "Main Building", "04", 14, "/rooms/the-library.png", ["Projector", "HDMI"]],
  ["Focus Room", "North House", "01", 4, "/rooms/focus-room.png", ["Whiteboard"]],
  ["Atrium Room", "South Wing", "03", 20, "/rooms/atrium-room.png", ["Video Conference", "Projector"]],
  ["The Loft", "Main Building", "05", 10, "/rooms/the-loft.png", ["HDMI", "Whiteboard"]],
  ["Boardroom A", "South Wing", "02", 12, "/rooms/boardroom-a.png", ["Video Conference"]],
];

/** Only creates what is missing. Existing users, passwords, and rooms are never modified. */
export async function seed(db: PrismaClient) {
  for (const [email, fullName, password, role] of DEMO_USERS) {
    if (!(await db.user.findUnique({ where: { email } }))) {
      await db.user.create({ data: { email, fullName, role, passwordHash: await hashPassword(password) } });
    }
  }
  for (const name of FACILITY_NAMES) {
    if (!(await db.facility.findUnique({ where: { name } }))) await db.facility.create({ data: { name } });
  }
  const facilities = await db.facility.findMany({ where: { name: { in: FACILITY_NAMES } } });
  const byName = new Map(facilities.map((facility) => [facility.name, facility.id]));
  for (const [name, building, floor, capacity, imageUrl, names] of DEMO_ROOMS) {
    if (!(await db.room.findUnique({ where: { name } }))) {
      await db.room.create({
        data: {
          name,
          building,
          floor,
          capacity,
          imageUrl,
          facilities: { connect: names.map((item) => ({ id: byName.get(item)! })) },
        },
      });
    }
  }
}
