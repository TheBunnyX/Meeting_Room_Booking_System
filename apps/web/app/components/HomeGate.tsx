"use client";

import { useCallback, useEffect, useState } from "react";
import { WorkspaceView } from "../../features/workspace/WorkspaceView";
import { apiFetch, errorMessage } from "../../lib/api";
import type { User } from "../../lib/types";
import { LoginForm } from "./LoginForm";
import { ShellSkeleton } from "./ShellSkeleton";

type State = { status: "loading" } | { status: "signed-out" } | { status: "signed-in" } | { status: "error"; message: string };

/** The home page: the sign-in form for visitors who are not signed in, the booking workspace for everyone else. */
export function HomeGate() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // A signed-out visitor is the normal case here, so the 401 must not redirect anywhere.
    apiFetch<User>("/api/v1/auth/me", { redirectOnUnauthorized: false })
      .then((profile) => {
        if (cancelled) return;
        if (profile.must_change_password) window.location.assign("/change-password");
        else setState({ status: "signed-in" });
      })
      .catch((reason) => {
        if (cancelled) return;
        if (reason?.status === 401) setState({ status: "signed-out" });
        else setState({ status: "error", message: errorMessage(reason, "Your session could not be loaded.") });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);

  if (state.status === "loading") return <ShellSkeleton />;
  if (state.status === "signed-out") return <LoginForm />;
  if (state.status === "error") {
    return <main className="shell"><div className="admin-loading" role="alert"><p>{state.message}</p><button type="button" className="text-button" onClick={retry}>Try again</button></div></main>;
  }
  return <WorkspaceView view="home" />;
}
