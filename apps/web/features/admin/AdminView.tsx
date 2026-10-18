"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "../../app/components/AppShell";
import { Icon } from "../../app/components/icons";
import { showError, showSuccess } from "../../lib/alerts";
import { apiFetch, errorMessage } from "../../lib/api";
import { isManager, type Booking, type Dashboard, type Facility, type Maintenance, type Room, type User } from "../../lib/types";
import { ApprovalsPanel } from "./ApprovalsPanel";
import { AuditLogPanel } from "./AuditLogPanel";
import { MaintenancePanel } from "./MaintenancePanel";
import { PeoplePanel } from "./PeoplePanel";
import { ReportsPanel } from "./ReportsPanel";
import { RoomsPanel } from "./RoomsPanel";

type AdminData = {
  users: User[];
  rooms: Room[];
  facilities: Facility[];
  pending: Booking[];
  maintenance: Maintenance[];
  dashboard: Dashboard;
};

/** Run a change, reload the admin data, and report the outcome. Resolves to whether it succeeded. */
export type Perform = (action: () => Promise<unknown>, success: string, failure: string) => Promise<boolean>;

export function AdminView() {
  return <AppShell routeClass="route-admin" eyebrow="Workspace / Admin" title="Keep the room for good work.">
    {(user) => isManager(user.role) ? <Admin me={user} /> : <Restricted />}
  </AppShell>;
}

function Restricted() {
  return <section className="admin-hero"><p className="eyebrow">403 / Restricted</p><h1>Admin access required.</h1><p>Your account does not have permission to manage this workspace.</p><p><Link className="primary" href="/">Back to workspace <Icon name="right" size={15} /></Link></p></section>;
}

function Admin({ me }: { me: User }) {
  const isAdmin = me.role === "ADMIN";
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState("");
  // Bumped on every reload so the panels that fetch their own data (reports, activity) refresh too.
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    setError("");
    try {
      const [users, rooms, facilities, pending, maintenance, dashboard] = await Promise.all([
        // Only full admins may list people; the API rejects this call for facility admins.
        isAdmin ? apiFetch<User[]>("/api/v1/users") : Promise.resolve([]),
        apiFetch<Room[]>("/api/v1/rooms?include_inactive=true"),
        apiFetch<Facility[]>("/api/v1/facilities"),
        apiFetch<Booking[]>("/api/v1/bookings/pending"),
        apiFetch<Maintenance[]>("/api/v1/maintenance"),
        apiFetch<Dashboard>("/api/v1/dashboard"),
      ]);
      setData({ users, rooms, facilities, pending, maintenance, dashboard });
      setVersion((value) => value + 1);
    } catch (reason) {
      setError(errorMessage(reason, "Unable to load admin data."));
    }
  }, [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const perform: Perform = useCallback(async (action, success, failure) => {
    try {
      await action();
      await load();
      void showSuccess(success);
      return true;
    } catch (reason) {
      void showError(errorMessage(reason, failure), failure);
      return false;
    }
  }, [load]);

  if (error && !data) {
    return <div className="admin-loading" role="alert"><p>{error}</p><button type="button" className="text-button" onClick={load}>Try again</button></div>;
  }
  if (!data) return <div className="admin-loading" role="status">Loading workspace administration…</div>;

  const metrics: [string, number][] = [
    ["Bookings today", data.dashboard.bookings_today],
    ["Active rooms", data.dashboard.active_rooms],
    ["Cancelled", data.dashboard.cancelled_bookings],
    ["No-shows", data.dashboard.no_shows],
  ];

  return <>
    <section className="admin-hero"><p className="eyebrow">Workspace administration · {isAdmin ? "Full admin" : "Facility admin"}</p><h1>Keep the room<br />for good work.</h1><p>Manage people, spaces and the rules that keep your calendar reliable.</p></section>
    {error && <div className="admin-alert error" role="alert">{error}<button type="button" onClick={load} aria-label="Retry">↻</button></div>}
    <section className="metric-grid">{metrics.map(([label, value]) => <div className="metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>
    <section className="admin-grid">
      {isAdmin && <PeoplePanel me={me} users={data.users} perform={perform} onChanged={load} />}
      <RoomsPanel rooms={data.rooms} facilities={data.facilities} perform={perform} />
      <ApprovalsPanel pending={data.pending} perform={perform} />
      <MaintenancePanel rooms={data.rooms} maintenance={data.maintenance} perform={perform} />
      <ReportsPanel version={version} />
      {isAdmin && <AuditLogPanel version={version} />}
    </section>
  </>;
}
