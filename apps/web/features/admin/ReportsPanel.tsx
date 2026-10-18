"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "../../app/components/icons";
import { showError } from "../../lib/alerts";
import { apiDownload, apiFetch, errorMessage } from "../../lib/api";
import type { Report } from "../../lib/types";

/** Query string limiting a report to one `YYYY-MM` month in local time; empty for all time. */
function periodQuery(month: string) {
  if (!month) return "";
  const [year, monthNumber] = month.split("-").map(Number);
  const params = new URLSearchParams({
    starts_at: new Date(year, monthNumber - 1, 1).toISOString(),
    ends_at: new Date(year, monthNumber, 1).toISOString(),
  });
  return `?${params}`;
}

/** Booking statistics for a chosen month or all time, with a CSV export of the same period. */
export function ReportsPanel({ version }: { version: number }) {
  const [month, setMonth] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      setReport(await apiFetch<Report>(`/api/v1/reports/summary${periodQuery(month)}`));
    } catch (reason) {
      setError(errorMessage(reason, "The report could not be loaded."));
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load, version]);

  async function exportCsv() {
    setExporting(true);
    try {
      await apiDownload(`/api/v1/reports/bookings.csv${periodQuery(month)}`, `bookings-${month || "all"}.csv`);
    } catch (reason) {
      void showError(errorMessage(reason, "The export could not be created."), "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return <div className="panel">
    <div className="section-head"><div><p className="eyebrow">Reports</p><h2>Booking health</h2></div><button type="button" className="primary small-button" disabled={exporting} onClick={exportCsv}><Icon name="download" size={14} /> {exporting ? "Exporting…" : "Export CSV"}</button></div>
    <div className="report-period">
      <label htmlFor="report-month">Month</label>
      <input id="report-month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
      <button type="button" className="text-button" disabled={!month} onClick={() => setMonth("")}>All time</button>
      <span className="section-meta">{month ? "Bookings starting in this month" : "All bookings"}</span>
    </div>
    {error ? <div className="booking-state" role="alert"><p className="error">{error}</p><button type="button" className="text-button" onClick={load}>Try again</button></div>
      : !report ? <p className="empty" role="status">Loading the report…</p>
      : <div className="report-list">
        <p>Total bookings <strong>{report.total_bookings}</strong></p>
        <p>Cancelled <strong>{report.cancelled_bookings} · {report.cancellation_rate}%</strong></p>
        <p>No-shows <strong>{report.no_show_bookings} · {report.no_show_rate}%</strong></p>
        <p>Rejected requests <strong>{report.rejected_bookings}</strong></p>
        <h3>Most used rooms</h3>
        {report.most_used_rooms.map((item) => <p key={item.room}>{item.room} <strong>{item.bookings}</strong></p>)}
        <p className="report-note">Cancelled and rejected requests are not counted as room use.</p>
      </div>}
  </div>;
}
