"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { apiFetch, errorMessage, safeNextPath } from "../../lib/api";
import type { TokenResponse } from "../../lib/types";
import demoAccounts from "../../data/demo-accounts.json";
import { Icon } from "./icons";

// Every account of the starting data (data/demo-accounts.json, written by scripts/build-seed.mjs), so a demo can
// switch between people without explaining anything. Set NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS=false to hide the list.
type DemoAccount = { email: string; name: string; password: string; role: string };
const DEMO_ACCOUNTS = demoAccounts as DemoAccount[];
const SHOW_DEMO_ACCOUNTS = process.env.NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS !== "false";
const ROLE_LABELS: Record<string, string> = { ADMIN: "Admin", FACILITY_ADMIN: "Facility admin", USER: "User" };

/** The sign-in form. It is the home page for visitors who are not signed in. */
export function LoginForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function fillDemoAccount(account: DemoAccount) {
    const form = formRef.current;
    if (!form) return;
    (form.elements.namedItem("email") as HTMLInputElement).value = account.email;
    (form.elements.namedItem("password") as HTMLInputElement).value = account.password;
    setError("");
  }

  useEffect(() => {
    // Sessions used to be kept here; they now live in an HTTP-only cookie.
    window.localStorage.removeItem("meetinghub_token");
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    const form = new FormData(event.currentTarget);
    setLoading(true);
    setError("");
    try {
      const session = await apiFetch<TokenResponse>("/api/v1/auth/login", {
        method: "POST",
        json: { email: form.get("email"), password: form.get("password") },
        redirectOnUnauthorized: false,
      });
      // A full navigation so every page starts from the new session. `next` is where the visitor
      // was heading before being asked to sign in (for example a scanned check-in code).
      const next = safeNextPath(new URLSearchParams(window.location.search).get("next"));
      window.location.assign(session.user.must_change_password ? "/change-password" : next);
    } catch (reason) {
      setError(errorMessage(reason, "Something went wrong. Please try again."));
      setLoading(false);
    }
  }

  return <main className="login-page"><div className="login-wrap">
    <Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">M</span><span>MeetingHub</span></Link>
    <p className="eyebrow">Welcome back</p><h1 className="login-title">Good to see you.</h1>
    <p>Sign in to view your schedule and reserve a room for your next conversation.</p>
    <form className="login-form" onSubmit={signIn} ref={formRef}>
      <div className="field"><label htmlFor="email">Work email</label><input id="email" name="email" type="email" required autoComplete="username" placeholder="you@company.com" /></div>
      <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" required autoComplete="current-password" placeholder="Your password" /></div>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={loading}>{loading ? "Signing in…" : <>Sign in <Icon name="right" size={15} /></>}</button>
    </form>
    <p className="helper"><Link className="text-link" href="/forgot-password">Forgot your password?</Link> · Need access? Ask your workspace administrator.</p>
    {SHOW_DEMO_ACCOUNTS && <section className="demo-accounts" aria-labelledby="demo-accounts-title">
      <p className="eyebrow" id="demo-accounts-title">Demo accounts ({DEMO_ACCOUNTS.length})</p>
      <ul>
        {DEMO_ACCOUNTS.map((account) => <li key={account.email}>
          <div><strong>{account.name} · {ROLE_LABELS[account.role] ?? account.role}</strong><small>{account.email} / {account.password}</small></div>
          <button type="button" className="text-button" onClick={() => fillDemoAccount(account)}>Use</button>
        </li>)}
      </ul>
    </section>}
  </div></main>;
}
