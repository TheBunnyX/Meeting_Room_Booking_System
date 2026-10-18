"use client";

import { useState, type FormEvent } from "react";
import { confirmAction, showError, showPassword } from "../../lib/alerts";
import { apiFetch, errorMessage } from "../../lib/api";
import type { Role, User } from "../../lib/types";
import type { Perform } from "./AdminView";

type PeoplePanelProps = { me: User; users: User[]; perform: Perform; onChanged: () => Promise<void> };

const ROLE_OPTIONS: [Role, string][] = [["USER", "User"], ["FACILITY_ADMIN", "Facility Admin"], ["ADMIN", "Admin"]];

export function PeoplePanel({ me, users, perform, onChanged }: PeoplePanelProps) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const created = await apiFetch<User & { temporary_password: string }>("/api/v1/users", {
        method: "POST",
        json: {
          email: form.get("email"),
          full_name: form.get("full_name"),
          department: form.get("department") || null,
          team: form.get("team") || null,
          role: form.get("role"),
        },
      });
      setShowForm(false);
      await onChanged();
      await showPassword(created.temporary_password);
    } catch (reason) {
      void showError(errorMessage(reason, "Could not create employee."), "Employee creation failed");
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword(user: User) {
    if (!(await confirmAction(`${user.full_name} will be signed out and must use a new temporary password.`, "Reset password"))) return;
    try {
      const result = await apiFetch<{ temporary_password: string }>(`/api/v1/users/${user.id}/reset-password`, { method: "POST" });
      await showPassword(result.temporary_password);
    } catch (reason) {
      void showError(errorMessage(reason, "Could not reset password."), "Password reset failed");
    }
  }

  const update = (user: User, values: Partial<Pick<User, "role" | "is_active">>) =>
    perform(() => apiFetch(`/api/v1/users/${user.id}`, { method: "PATCH", json: values }), "Employee updated.", "Employee update failed");

  return <div className="panel">
    <div className="section-head"><div><p className="eyebrow">People</p><h2>Employees & roles</h2></div><button type="button" className="primary small-button" aria-expanded={showForm} onClick={() => setShowForm(!showForm)}>{showForm ? "Close" : "Add employee"}</button></div>
    {showForm && <form className="admin-form" onSubmit={createUser}>
      <input name="full_name" required minLength={2} maxLength={150} placeholder="Full name" aria-label="Full name" />
      <input name="email" required type="email" placeholder="Work email" aria-label="Work email" />
      <input name="department" maxLength={100} placeholder="Department" aria-label="Department" />
      <input name="team" maxLength={100} placeholder="Team" aria-label="Team" />
      <select name="role" defaultValue="USER" aria-label="Role">{ROLE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <button className="primary" disabled={saving}>{saving ? "Creating…" : "Create employee"}</button>
    </form>}
    <div className="admin-list">
      {users.length ? users.map((user) => {
        // The API refuses self-demotion and self-deactivation; the controls mirror that.
        const isSelf = user.id === me.id;
        return <div className={`admin-row ${!user.is_active ? "muted" : ""}`} key={user.id}>
          <div><strong>{user.full_name}{isSelf ? " (you)" : ""}{!user.is_active ? " · Inactive" : ""}</strong><small>{user.email} · {user.department || "No department"} / {user.team || "No team"}</small></div>
          <div className="admin-row-actions">
            <select value={user.role} disabled={isSelf} aria-label={`Role for ${user.full_name}`} onChange={(event) => update(user, { role: event.target.value as Role })}>{ROLE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <button type="button" className="text-button" disabled={isSelf} onClick={() => update(user, { is_active: !user.is_active })}>{user.is_active ? "Deactivate" : "Activate"}</button>
            <button type="button" className="text-button" onClick={() => resetPassword(user)}>Reset password</button>
          </div>
        </div>;
      }) : <p className="empty">No employees yet.</p>}
    </div>
  </div>;
}
