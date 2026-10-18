import { NextResponse } from "next/server";

import { parseBody, parseId, route } from "@/lib/server/route";
import { currentUser, verifyCheckInToken } from "@/lib/server/security";
import { checkInRead } from "@/lib/server/serializers";
import { checkInAtRoom } from "@/lib/server/services/bookings";
import { checkInCodeSchema } from "@/lib/server/validation";

// Target of the QR code on the screen at the room: checks in the own booking that is due now.
export const POST = route<{ roomId: string }>(async (request, { roomId }) => {
  const user = await currentUser(request);
  const id = parseId(roomId, "room_id");
  const { token } = await parseBody(request, checkInCodeSchema);
  // The code proves the caller saw the screen at the room moments ago.
  await verifyCheckInToken(token, id);
  const { booking, created } = await checkInAtRoom(user, id);
  return NextResponse.json(checkInRead(booking, created));
});
