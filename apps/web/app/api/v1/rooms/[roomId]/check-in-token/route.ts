import { NextResponse } from "next/server";

import { parseId, route } from "@/lib/server/route";
import { CHECK_IN_TOKEN_LIFETIME_SECONDS, createCheckInToken, requireRoles } from "@/lib/server/security";
import { getRoom } from "@/lib/server/services/rooms";

// A fresh code for the screen at the room to show as a QR code. Managers only.
export const GET = route<{ roomId: string }>(async (request, { roomId }) => {
  await requireRoles(request, "ADMIN", "FACILITY_ADMIN");
  const room = await getRoom(parseId(roomId, "room_id"));
  return NextResponse.json({
    token: await createCheckInToken(room.id),
    expires_in: CHECK_IN_TOKEN_LIFETIME_SECONDS,
    room_name: room.name,
  });
});
