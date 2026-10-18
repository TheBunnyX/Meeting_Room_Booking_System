"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { apiFetch, errorMessage } from "../../lib/api";
import { Icon } from "../components/icons";

export default function ForgotPasswordPage() {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const form = new FormData(event.currentTarget);
    setSending(true);
    setError("");
    try {
      const result = await apiFetch<{ message: string }>("/api/v1/auth/forgot-password", {
        method: "POST",
        json: { email: form.get("email") },
        redirectOnUnauthorized: false,
      });
      setSent(result.message);
    } catch (reason) {
      setError(errorMessage(reason, "Your request could not be sent. Please try again."));
    } finally {
      setSending(false);
    }
  }

  return <main className="login-page"><div className="login-wrap">
    <Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">M</span><span>MeetingHub</span></Link>
    <p className="eyebrow">Account access</p><h1 className="login-title">Forgot password?</h1>
    {sent ? <>
      <p role="status">{sent} They will give you a temporary password, which you replace the first time you sign in.</p>
      <Link className="primary" href="/">Back to sign in <Icon name="right" size={15} /></Link>
    </> : <>
      <p>Enter your work email. A workspace administrator will be asked to issue you a temporary password.</p>
      <form className="login-form" onSubmit={submit}>
        <div className="field"><label htmlFor="email">Work email</label><input id="email" name="email" type="email" required autoComplete="username" placeholder="you@company.com" /></div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" type="submit" disabled={sending}>{sending ? "Sending…" : <>Request a reset <Icon name="right" size={15} /></>}</button>
      </form>
      <p className="helper"><Link className="text-link" href="/">Back to sign in</Link></p>
    </>}
  </div></main>;
}
