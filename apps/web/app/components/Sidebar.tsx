"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { initials } from "../../lib/datetime";
import { isManager, type User } from "../../lib/types";
import { Icon } from "./icons";

type SidebarProps = {
  user: User;
  collapsed: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSignOut: () => void;
};

const links = [
  { label: "Find a room", href: "/", icon: "home" as const, section: "Workspace", also: [] as string[], managerOnly: false },
  { label: "My bookings & calendar", href: "/bookings", icon: "calendar" as const, section: "Workspace", also: ["/calendar"], managerOnly: false },
  { label: "Rooms & people", href: "/admin", icon: "users" as const, section: "Manage", also: [], managerOnly: true },
  { label: "Booking policy", href: "/policy", icon: "settings" as const, section: "Manage", also: [], managerOnly: false },
];

export function Sidebar({ user, collapsed, onToggle, onClose, onSignOut }: SidebarProps) {
  const pathname = usePathname();
  const groupedLinks = ["Workspace", "Manage"];
  // Hiding the link is a convenience only; the API enforces who may use the admin tools.
  const visibleLinks = links.filter((link) => !link.managerOnly || isManager(user.role));

  return <>
    <aside className="sidebar">
      <div className="sidebar-brand-row"><Link className="brand sidebar-brand" href="/"><span className="brand-mark" aria-hidden="true">M</span><span className="brand-name">MeetingHub</span></Link><button type="button" className="sidebar-toggle" onClick={onToggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed}><Icon name="menu" size={18} /></button></div>
      <nav aria-label="Main">
        {groupedLinks.map((section) => <div className="sidebar-section" key={section}>
          <p className="sidebar-label">{section}</p>
          {visibleLinks.filter((link) => link.section === section).map((link) => {
            const active = [link.href, ...link.also].includes(pathname);
            return <Link className={`sidebar-link ${active ? "active" : ""}`} title={link.label} href={link.href} aria-current={active ? "page" : undefined} onClick={onClose} key={link.href}>
              <span className="sidebar-icon"><Icon name={link.icon} size={18} /></span><span className="sidebar-link-label">{link.label}</span>
            </Link>;
          })}
        </div>)}
      </nav>
      <div className="sidebar-bottom"><div className="sidebar-user"><span className="avatar" aria-hidden="true">{initials(user.full_name)}</span><div><strong>{user.full_name}</strong><small>{user.email}</small></div></div><Link className="sidebar-account-link" href="/change-password" onClick={onClose}>Change password</Link><button type="button" className="sidebar-logout" onClick={onSignOut} aria-label="Sign out" title="Sign out"><span className="sidebar-logout-label">Sign out</span><Icon name="logout" size={14} /></button></div>
    </aside>
    <div className="sidebar-scrim" onClick={onClose} aria-hidden="true" />
  </>;
}
