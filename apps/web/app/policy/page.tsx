"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, errorMessage } from "../../lib/api";
import type { BookingPolicy } from "../../lib/types";
import { AppShell } from "../components/AppShell";

export default function PolicyPage() {
  return <AppShell routeClass="route-policy" eyebrow="Manage / MeetingHub" title="Booking policy">
    {() => <Policy />}
  </AppShell>;
}

function Policy() {
  // The limits are read from the API so this page always states what the backend enforces.
  const [policy, setPolicy] = useState<BookingPolicy | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setPolicy(await apiFetch<BookingPolicy>("/api/v1/booking-policy"));
    } catch (reason) {
      setError(errorMessage(reason, "The booking policy could not be loaded."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return <>
    <section className="admin-hero"><p className="eyebrow">05 / Booking policy</p><h1>Keep bookings<br />predictable.</h1><p>Clear rules help every team find a room when they need one.</p></section>
    <section className="policy-page panel">
      <div className="section-head"><div><p className="eyebrow">Workspace rules</p><h2>Booking limits</h2></div></div>
      {error ? <div className="booking-state" role="alert"><p className="error">{error}</p><button type="button" className="text-button" onClick={load}>Try again</button></div>
        : !policy ? <p className="empty" role="status">Loading the booking policy…</p>
        : <>
          <div className="policy-grid">
            <div><strong>{policy.max_duration_hours} hours</strong><span>Maximum booking duration</span></div>
            <div><strong>{policy.max_advance_days} days</strong><span>Maximum advance booking window</span></div>
            <div><strong>{policy.check_in_grace_minutes} minutes</strong><span>Check-in grace period before a booking becomes a no-show</span></div>
            <div><strong>{policy.recurring_booking_supported ? "Weekly" : "One-time"}</strong><span>{policy.recurring_booking_supported ? "Recurring bookings are supported" : "Recurring bookings are not available"}</span></div>
          </div>
          <p className="policy-note">Bookings are checked for overlapping times, room capacity, opening hours ({policy.timezone} time) and maintenance windows before confirmation. Check-in opens {policy.check_in_opens_minutes_before} minutes before a booking starts. Some rooms need approval from a facility admin before the booking is confirmed.</p>
        </>}
    </section>
  </>;
}
