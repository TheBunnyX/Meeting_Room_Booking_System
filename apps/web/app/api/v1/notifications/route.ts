import { NextResponse } from "next/server";

import { parseQuery, route } from "@/lib/server/route";
import { currentUser } from "@/lib/server/security";
import { notificationRead } from "@/lib/server/serializers";
import { sweepInBackground } from "@/lib/server/services/jobs";
import { listForUser } from "@/lib/server/services/notifications";
import { notificationsQuerySchema } from "@/lib/server/validation";

export const GET = route(async (request) => {
  const user = await currentUser(request);
  const { limit } = parseQuery(request, notificationsQuerySchema);
  const { items, unread } = await listForUser(user, limit);
  // The notification bell polls this endpoint, so it also keeps reminders and no-shows current.
  sweepInBackground();
  return NextResponse.json({ items: items.map(notificationRead), unread_count: unread });
});
