"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useSession } from "../../hooks/useSession";
import { initials } from "../../lib/datetime";
import type { User } from "../../lib/types";
import { NotificationBell } from "./NotificationBell";
import { Sidebar } from "./Sidebar";

const COLLAPSED_KEY = "meetinghub_sidebar_collapsed";

type AppShellProps = {
  routeClass: string;
  eyebrow: string;
  title: string;
  children: (user: User) => ReactNode;
};

/** Signed-in page frame: resolves the session, then renders the sidebar, top bar and page body. */
export function AppShell({ routeClass, eyebrow, title, children }: AppShellProps) {
  const { user, loading, error, retry, signOut } = useSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    setSidebarCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "true");
  }, []);

  function toggleSidebar() {
    if (window.matchMedia("(max-width: 700px)").matches) {
      setSidebarOpen((open) => !open);
      return;
    }
    setSidebarCollapsed((collapsed) => {
      window.localStorage.setItem(COLLAPSED_KEY, String(!collapsed));
      return !collapsed;
    });
  }

  if (error) {
    return <main className="shell"><div className="admin-loading" role="alert"><p>{error}</p><button type="button" className="text-button" onClick={retry}>Try again</button></div></main>;
  }
  if (loading || !user) {
    return <main className="shell app-shell route-loading" aria-busy="true">
      <aside className="sidebar skeleton-sidebar" aria-hidden="true">
        <div className="skeleton skeleton-line" style={{ width: "55%", height: 28, marginBottom: 32 }} />
        {[0, 1, 2, 3].map((item) => <div className="skeleton skeleton-line" style={{ height: 36 }} key={item} />)}
      </aside>
      <div className="workspace">
        <p className="sr-only" role="status">Loading your workspace…</p>
        <div className="skeleton skeleton-title" aria-hidden="true" />
        <div className="skeleton skeleton-line" style={{ width: "40%" }} aria-hidden="true" />
        <div className="room-grid" aria-hidden="true">{[0, 1, 2].map((item) => <div className="room-card skeleton skeleton-card" key={item} />)}</div>
      </div>
    </main>;
  }

  return <main className={`shell app-shell ${routeClass} ${sidebarOpen ? "sidebar-visible" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
    <Sidebar user={user} collapsed={sidebarCollapsed} onToggle={toggleSidebar} onClose={() => setSidebarOpen(false)} onSignOut={signOut} />
    <div className="workspace">
      <header className="topbar">
        <div className="topbar-context"><span className="eyebrow">{eyebrow}</span><span className="topbar-title">{title}</span></div>
        <div className="topbar-actions"><NotificationBell /><span className="avatar topbar-avatar" title={user.full_name}>{initials(user.full_name)}</span></div>
      </header>
      {children(user)}
    </div>
  </main>;
}
