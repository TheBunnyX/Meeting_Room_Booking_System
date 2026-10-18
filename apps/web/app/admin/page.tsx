import type { Metadata } from "next";
import { AdminView } from "../../features/admin/AdminView";

export const metadata: Metadata = { title: "Admin" };

export default function AdminPage() {
  return <AdminView />;
}
