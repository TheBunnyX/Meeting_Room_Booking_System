import { NextResponse } from "next/server";

import { route } from "@/lib/server/route";
import { requireRoles } from "@/lib/server/security";
import { runStatusSweep } from "@/lib/server/services/jobs";

// Run the status sweep on demand; cron and traffic run the same job in the background.
export const POST = route(async (request) => {
  await requireRoles(request, "ADMIN", "FACILITY_ADMIN");
  const { noShows, completed, reminders } = await runStatusSweep();
  return NextResponse.json({ marked_no_show: noShows, marked_completed: completed, reminders_sent: reminders });
});
