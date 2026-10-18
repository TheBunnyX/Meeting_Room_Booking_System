import type { Metadata } from "next";
import { WorkspaceView } from "../../features/workspace/WorkspaceView";

export const metadata: Metadata = { title: "Calendar" };

export default function CalendarPage() {
  return <WorkspaceView view="calendar" />;
}
