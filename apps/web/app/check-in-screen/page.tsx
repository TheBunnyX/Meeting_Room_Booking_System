import type { Metadata } from "next";
import { CheckInScreen } from "../../features/admin/CheckInScreen";

export const metadata: Metadata = { title: "Check-in screen", robots: { index: false } };

export default function CheckInScreenPage() {
  return <CheckInScreen />;
}
