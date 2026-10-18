// Regenerate data/db.json (the starting data of the app): node scripts/build-seed.mjs
// Edit the lists below to change the demo users, equipment or rooms, then run it again.
import { writeFileSync } from "node:fs";

import { hashPassword } from "./hash-password.mjs";

const users = [
  ["admin@meetinghub.com", "System Administrator", "Admin123!", "ADMIN"],
  ["user@meetinghub.com", "MeetingHub User", "User123!", "USER"],
];
const facilityNames = ["TV", "Projector", "Whiteboard", "Video Conference", "HDMI"];
const rooms = [
  ["Studio 01", "North House", "02", 8, "/rooms/studio-01.png", ["Video Conference", "Whiteboard"]],
  ["The Library", "Main Building", "04", 14, "/rooms/the-library.png", ["Projector", "HDMI"]],
  ["Focus Room", "North House", "01", 4, "/rooms/focus-room.png", ["Whiteboard"]],
  ["Atrium Room", "South Wing", "03", 20, "/rooms/atrium-room.png", ["Video Conference", "Projector"]],
  ["The Loft", "Main Building", "05", 10, "/rooms/the-loft.png", ["HDMI", "Whiteboard"]],
  ["Boardroom A", "South Wing", "02", 12, "/rooms/boardroom-a.png", ["Video Conference"]],
];

const facilities = facilityNames.map((name, index) => ({ id: index + 1, name }));
const facilityId = (name) => facilities.find((facility) => facility.name === name).id;

const data = {
  users: users.map(([email, full_name, password, role], index) => ({
    id: index + 1,
    email,
    full_name,
    department: null,
    team: null,
    role,
    is_active: true,
    must_change_password: false,
    password_hash: hashPassword(password),
  })),
  facilities,
  rooms: rooms.map(([name, building, floor, capacity, image_url, equipment], index) => ({
    id: index + 1,
    name,
    building,
    floor,
    capacity,
    image_url,
    opens_at: "08:00",
    closes_at: "18:00",
    requires_approval: false,
    is_active: true,
    facility_ids: equipment.map(facilityId),
  })),
};

writeFileSync(new URL("../data/db.json", import.meta.url), `${JSON.stringify(data, null, 2)}\n`);
console.log(`Wrote data/db.json: ${data.users.length} users, ${data.facilities.length} facilities, ${data.rooms.length} rooms`);
