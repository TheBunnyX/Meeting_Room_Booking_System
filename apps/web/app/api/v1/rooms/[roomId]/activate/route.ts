import { NextResponse } from "next/server";

import { parseId, route } from "@/lib/server/route";
import { requireRoles } from "@/lib/server/security";
import { roomRead } from "@/lib/server/serializers";
import { setRoomActive } from "@/lib/server/services/rooms";

export const POST = route<{ roomId: string }>(async (request, { roomId }) => {
  const actor = await requireRoles(request, "ADMIN", "FACILITY_ADMIN");
  return NextResponse.json(roomRead(await setRoomActive(actor, parseId(roomId, "room_id"), true)));
});
