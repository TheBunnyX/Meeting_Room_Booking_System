"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiFetch, errorMessage } from "../../lib/api";
import { formatDateTime } from "../../lib/datetime";
import type { CheckInResult } from "../../lib/types";
import { Icon } from "../components/icons";

type State = { status: "working" } | { status: "done"; result: CheckInResult } | { status: "failed"; message: string };

/**
 * Landing page of the QR code shown on the screen at each room (/check-in?room=ID&t=CODE). Opening
 * it checks in the signed-in user's booking for that room. The code in the link renews every few
 * seconds on the screen, so only someone who saw the screen recently can use it. Visitors who are
 * signed out are sent to sign in first and brought back here.
 */
export default function CheckInPage() {
  const [state, setState] = useState<State>({ status: "working" });
  const started = useRef(false);

  useEffect(() => {
    // Development mode runs effects twice; one scan must record one check-in.
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const room = Number(params.get("room"));
    const token = params.get("t");
    if (!Number.isInteger(room) || room <= 0 || !token) {
      setState({ status: "failed", message: "This check-in link is not valid. Scan the code on the screen at the room." });
      return;
    }
    apiFetch<CheckInResult>(`/api/v1/rooms/${room}/check-in`, { method: "POST", json: { token } })
      .then((result) => setState({ status: "done", result }))
      .catch((reason) => {
        // Signed-out visitors and temporary passwords are already being redirected.
        if (reason?.status === 401 || reason?.code === "PASSWORD_CHANGE_REQUIRED") return;
        setState({ status: "failed", message: errorMessage(reason, "Check-in could not be recorded.") });
      });
  }, []);

  return <main className="login-page"><div className="login-wrap">
    <Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">M</span><span>MeetingHub</span></Link>
    <p className="eyebrow">Room check-in</p>
    {state.status === "working" && <><h1 className="login-title">Checking you in…</h1><p role="status">One moment while we find your booking for this room.</p></>}
    {state.status === "done" && <>
      <h1 className="login-title">{state.result.message === "Already checked in" ? "Already checked in." : "You're checked in."}</h1>
      <p role="status">{state.result.title} · {state.result.room_name} · checked in {formatDateTime(state.result.checked_in_at)}.</p>
    </>}
    {state.status === "failed" && <><h1 className="login-title">Not checked in.</h1><p role="alert">{state.message}</p></>}
    {state.status !== "working" && <Link className="primary" href="/bookings">My bookings <Icon name="right" size={15} /></Link>}
  </div></main>;
}
