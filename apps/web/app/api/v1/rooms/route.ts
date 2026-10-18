import { NextResponse } from "next/server";

import { parseBody, parseQuery, route } from "@/lib/server/route";
import { currentUser, requireRoles } from "@/lib/server/security";
import { roomRead } from "@/lib/server/serializers";
import { MANAGER_ROLES } from "@/lib/server/services/bookings";
import { createRoom, listRooms } from "@/lib/server/services/rooms";
import { roomInputSchema, roomsQuerySchema } from "@/lib/server/validation";

export const GET = route(async (request) => {
  const user = await currentUser(request);
  const { capacity, building, include_inactive } = parseQuery(request, roomsQuerySchema);
  const rooms = await listRooms(capacity, building, Boolean(include_inactive) && MANAGER_ROLES.includes(user.role));
  return NextResponse.json(rooms.map(roomRead));
});

export const POST = route(async (request) => {
  const actor = await requireRoles(request, "ADMIN", "FACILITY_ADMIN");
  const payload = await parseBody(request, roomInputSchema);
  return NextResponse.json(roomRead(await createRoom(actor, payload)), { status: 201 });
});
