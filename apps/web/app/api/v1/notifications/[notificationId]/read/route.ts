import { NextResponse } from "next/server";

import { parseId, route } from "@/lib/server/route";
import { currentUser } from "@/lib/server/security";
import { notificationRead } from "@/lib/server/serializers";
import { markRead } from "@/lib/server/services/notifications";

export const POST = route<{ notificationId: string }>(async (request, { notificationId }) => {
  const user = await currentUser(request);
  return NextResponse.json(notificationRead(await markRead(user, parseId(notificationId, "notification_id"))));
});
