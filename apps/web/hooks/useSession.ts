"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, errorMessage } from "../lib/api";
import type { User } from "../lib/types";

type Session = { user: User | null; loading: boolean; error: string; retry: () => void; signOut: () => Promise<void> };

/**
 * The signed-in user, loaded from the API. The session lives in an HTTP-only cookie, so asking
 * the API is the only way to know who is signed in; apiFetch sends visitors without a session
 * to /login and users with a temporary password to /change-password.
 */
export function useSession(): Session {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    apiFetch<User>("/api/v1/auth/me")
      .then((profile) => {
        if (cancelled) return;
        if (profile.must_change_password) window.location.assign("/change-password");
        else setUser(profile);
      })
      .catch((reason) => {
        // A 401 is already on its way to /login; only surface failures the user can retry.
        if (!cancelled && reason?.status !== 401) setError(errorMessage(reason, "Your session could not be loaded."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const signOut = useCallback(async () => {
    try {
      await apiFetch("/api/v1/auth/logout", { method: "POST", redirectOnUnauthorized: false });
    } catch {
      // Already signed out, or offline: the sign-in page is still the right place to land.
    }
    window.location.assign("/login");
  }, []);

  return { user, loading, error, retry, signOut };
}
