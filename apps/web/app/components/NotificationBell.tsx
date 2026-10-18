"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import { formatDateTime } from "../../lib/datetime";
import type { Notification, NotificationList } from "../../lib/types";
import { Icon } from "./icons";

const REFRESH_MS = 60_000;

/** Bell in the top bar: unread count, and a panel listing the latest notifications. */
export function NotificationBell() {
  const router = useRouter();
  const [data, setData] = useState<NotificationList>({ items: [], unread_count: 0 });
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<NotificationList>("/api/v1/notifications"));
    } catch {
      // A failed refresh keeps the last known list; the next tick tries again.
    }
  }, []);

  useEffect(() => {
    void load();
    // A hidden tab does not need fresh data, so it neither polls nor wakes the server.
    const refresh = () => {
      if (!document.hidden) void load();
    };
    const timer = window.setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function toggle() {
    if (!open) void load();
    setOpen(!open);
  }

  async function openNotification(item: Notification) {
    setOpen(false);
    if (!item.is_read) {
      setData((current) => ({
        items: current.items.map((entry) => entry.id === item.id ? { ...entry, is_read: true } : entry),
        unread_count: Math.max(0, current.unread_count - 1),
      }));
      try {
        await apiFetch(`/api/v1/notifications/${item.id}/read`, { method: "POST" });
      } catch {
        void load();
      }
    }
    if (item.link) router.push(item.link);
  }

  async function markAllRead() {
    setData((current) => ({ items: current.items.map((entry) => ({ ...entry, is_read: true })), unread_count: 0 }));
    try {
      await apiFetch("/api/v1/notifications/read-all", { method: "POST" });
    } catch {
      void load();
    }
  }

  const unread = data.unread_count;

  return <div className="bell" ref={rootRef}>
    <button type="button" className="bell-button" ref={buttonRef} aria-haspopup="true" aria-expanded={open} aria-controls={panelId} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} onClick={toggle}>
      <Icon name="bell" size={17} />
      {unread > 0 && <span className="bell-badge" aria-hidden="true">{unread > 9 ? "9+" : unread}</span>}
    </button>
    {open && <div className="bell-panel" id={panelId}>
      <div className="bell-panel-head"><strong>Notifications</strong>{unread > 0 && <button type="button" className="text-button" onClick={markAllRead}>Mark all as read</button>}</div>
      {data.items.length ? <ul>
        {data.items.map((item) => <li key={item.id}>
          <button type="button" className={`bell-item ${item.is_read ? "" : "unread"}`} onClick={() => openNotification(item)}>
            <strong>{item.title}{!item.is_read && <span className="sr-only"> (unread)</span>}</strong>
            <span>{item.message}</span>
            <small>{formatDateTime(item.created_at)}</small>
          </button>
        </li>)}
      </ul> : <p className="empty">You have no notifications.</p>}
    </div>}
  </div>;
}
