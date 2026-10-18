import type { Metadata } from "next";
import { WorkspaceView } from "../../features/workspace/WorkspaceView";

export const metadata: Metadata = { title: "My bookings" };

export default function BookingsPage() {
  return <WorkspaceView view="bookings" />;
}
