import { NextResponse } from "next/server";

import { getConfig } from "@/lib/server/config";
import { requireCronSecret } from "@/lib/server/cron";
import { route } from "@/lib/server/route";
import { resetDemo } from "@/lib/server/services/jobs";

// Wipes all data back to the seed. Does nothing unless DEMO_MODE=true.
export const GET = route(async (request) => {
  requireCronSecret(request);
  if (!getConfig().demoMode) return NextResponse.json({ reset: false, reason: "DEMO_MODE is off" });
  await resetDemo();
  return NextResponse.json({ reset: true });
});
