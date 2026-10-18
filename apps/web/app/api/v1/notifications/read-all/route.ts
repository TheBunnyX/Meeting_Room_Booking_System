import { NextResponse } from "next/server";

import { route } from "@/lib/server/route";
import { currentUser } from "@/lib/server/security";
import { markAllRead } from "@/lib/server/services/notifications";

export const POST = route(async (request) => {
  await markAllRead(await currentUser(request));
  return NextResponse.json({ message: "All notifications marked as read" });
});
