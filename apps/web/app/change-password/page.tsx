"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { ApiError, apiFetch, errorMessage } from "../../lib/api";
import type { TokenResponse, User } from "../../lib/types";
import { Icon } from "../components/icons";

const MIN_LENGTH = 8;

export default function ChangePasswordPage() {
  const [user, setUser] = useState<User | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; field: string | null } | null>(null);

  useEffect(() => {
    // Signed-out visitors are sent to the sign-in form by apiFetch.
    apiFetch<User>("/api/v1/auth/me").then(setUser).catch((reason) => {
      if (reason?.status !== 401) setError({ message: errorMessage(reason, "Your session could not be loaded."), field: null });
    });
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("new_password"));
    if (newPassword !== String(form.get("confirm_password"))) {
      setError({ message: "The new passwords do not match.", field: "confirm_password" });
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch<TokenResponse>("/api/v1/auth/change-password", {
        method: "POST",
        json: { current_password: form.get("current_password"), new_password: newPassword },
      });
      window.location.assign("/");
    } catch (reason) {
      setError({ message: errorMessage(reason, "Your password could not be changed."), field: reason instanceof ApiError ? reason.field : null });
      setSaving(false);
    }
  }

  const fieldError = (name: string) => error?.field === name ? <p className="error field-error" id={`${name}-error`} role="alert">{error.message}</p> : null;
  const describedBy = (name: string) => error?.field === name ? `${name}-error` : undefined;
  const fields = ["current_password", "new_password", "confirm_password"];

  return <main className="login-page"><div className="login-wrap">
    <span className="brand"><span className="brand-mark" aria-hidden="true">M</span><span>MeetingHub</span></span>
    <p className="eyebrow">Account security</p><h1>Choose a new password.</h1>
    <p>{user?.must_change_password ? "You signed in with a temporary password. Replace it to continue." : "Changing your password signs you out everywhere else."}</p>
    <form className="login-form" onSubmit={submit}>
      <div className="field"><label htmlFor="current_password">Current password</label><input id="current_password" name="current_password" type="password" required autoComplete="current-password" aria-describedby={describedBy("current_password")} />{fieldError("current_password")}</div>
      <div className="field"><label htmlFor="new_password">New password</label><input id="new_password" name="new_password" type="password" required minLength={MIN_LENGTH} maxLength={128} autoComplete="new-password" aria-describedby={describedBy("new_password") ?? "new_password-hint"} /><small className="helper" id="new_password-hint">At least {MIN_LENGTH} characters.</small>{fieldError("new_password")}</div>
      <div className="field"><label htmlFor="confirm_password">Confirm new password</label><input id="confirm_password" name="confirm_password" type="password" required autoComplete="new-password" aria-describedby={describedBy("confirm_password")} />{fieldError("confirm_password")}</div>
      {error && !fields.includes(error.field ?? "") && <p className="error" role="alert">{error.message}</p>}
      <button className="primary" type="submit" disabled={saving || !user}>{saving ? "Saving…" : <>Change password <Icon name="right" size={15} /></>}</button>
    </form>
    {user && !user.must_change_password && <p className="helper"><Link className="text-link" href="/">Back to workspace</Link></p>}
  </div></main>;
}
