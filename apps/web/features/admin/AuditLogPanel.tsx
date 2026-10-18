"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, errorMessage } from "../../lib/api";
import { formatDateTime } from "../../lib/datetime";
import type { AuditLog } from "../../lib/types";

const PAGE_SIZE = 15;
const ENTITIES = ["Booking", "Room", "Maintenance", "User"];

function describe(details: AuditLog["details"]) {
  if (!details) return "";
  return Object.entries(details)
    .map(([key, value]) => `${key.replaceAll("_", " ")}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
    .join(" · ");
}

/** Who changed what, newest first. Full admins only; the API enforces that. */
export function AuditLogPanel({ version }: { version: number }) {
  const [entity, setEntity] = useState("");
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchPage = useCallback((offset: number) => {
    // One extra row tells us whether another page exists without a separate count request.
    const params = new URLSearchParams({ limit: String(PAGE_SIZE + 1), offset: String(offset) });
    if (entity) params.set("entity", entity);
    return apiFetch<AuditLog[]>(`/api/v1/audit-logs?${params}`);
  }, [entity]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const page = await fetchPage(0);
      setLogs(page.slice(0, PAGE_SIZE));
      setHasMore(page.length > PAGE_SIZE);
    } catch (reason) {
      setError(errorMessage(reason, "The activity log could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    void load();
  }, [load, version]);

  async function loadMore() {
    setLoading(true);
    try {
      const page = await fetchPage(logs.length);
      setLogs((current) => [...current, ...page.slice(0, PAGE_SIZE)]);
      setHasMore(page.length > PAGE_SIZE);
    } catch (reason) {
      setError(errorMessage(reason, "More activity could not be loaded."));
    } finally {
      setLoading(false);
    }
  }

  return <div className="panel audit-panel">
    <div className="section-head"><div><p className="eyebrow">Audit</p><h2>Activity log</h2></div>
      <select className="audit-filter" aria-label="Filter activity by type" value={entity} onChange={(event) => setEntity(event.target.value)}><option value="">All activity</option>{ENTITIES.map((item) => <option key={item} value={item}>{item}</option>)}</select>
    </div>
    <div className="admin-list">
      {error && <div className="booking-state" role="alert"><p className="error">{error}</p><button type="button" className="text-button" onClick={load}>Try again</button></div>}
      {!error && !logs.length && <p className="empty" role={loading ? "status" : undefined}>{loading ? "Loading activity…" : "No activity recorded yet."}</p>}
      {logs.map((log) => <div className="admin-row" key={log.id}>
        <div>
          <strong>{log.action.replaceAll("_", " ")} · {log.entity}{log.entity_id ? ` #${log.entity_id}` : ""}</strong>
          <small>{log.actor_name ?? "System"}{log.actor_email ? ` (${log.actor_email})` : ""}{describe(log.details) ? ` · ${describe(log.details)}` : ""}</small>
        </div>
        <span className="section-meta">{formatDateTime(log.created_at)}</span>
      </div>)}
    </div>
    {hasMore && <button type="button" className="text-button audit-more" disabled={loading} onClick={loadMore}>{loading ? "Loading…" : "Load more"}</button>}
  </div>;
}
