import { NextResponse } from "next/server";

import { route } from "@/lib/server/route";
import { requireCronSecret } from "@/lib/server/cron";
import { runStatusSweep } from "@/lib/server/services/jobs";

// Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`.
export const GET = route(async (request) => {
  requireCronSecret(request);
  const { noShows, completed, reminders } = await runStatusSweep();
  return NextResponse.json({ marked_no_show: noShows, marked_completed: completed, reminders_sent: reminders });
});
