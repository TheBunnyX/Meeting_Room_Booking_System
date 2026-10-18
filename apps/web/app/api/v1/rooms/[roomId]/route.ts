import { NextResponse } from "next/server";

import { parseBody, parseId, route } from "@/lib/server/route";
import { requireRoles } from "@/lib/server/security";
import { roomRead } from "@/lib/server/serializers";
import { setRoomActive, updateRoom } from "@/lib/server/services/rooms";
import { roomUpdateSchema } from "@/lib/server/validation";

export const PATCH = route<{ roomId: string }>(async (request, { roomId }) => {
  const actor = await requireRoles(request, "ADMIN", "FACILITY_ADMIN");
  const id = parseId(roomId, "room_id");
  const payload = await parseBody(request, roomUpdateSchema);
  return NextResponse.json(roomRead(await updateRoom(actor, id, payload)));
});

// Rooms are never deleted: removing one deactivates it so its booking history stays intact.
export const DELETE = route<{ roomId: string }>(async (request, { roomId }) => {
  const actor = await requireRoles(request, "ADMIN", "FACILITY_ADMIN");
  return NextResponse.json(roomRead(await setRoomActive(actor, parseId(roomId, "room_id"), false)));
});
