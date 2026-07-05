"use client";

import { useState, useEffect } from "react";

interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

interface SessionAuth {
  user: SessionUser | null;
  isLoaded: boolean;
  isSignedIn: boolean;
}

export function useSessionAuth(): SessionAuth {
  const [state, setState] = useState<SessionAuth>({
    user: null,
    isLoaded: false,
    isSignedIn: false,
  });

  useEffect(() => {
    fetch("/api/auth/session", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.user) {
          setState({
            user: data.user,
            isLoaded: true,
            isSignedIn: true,
          });
        } else {
          setState({ user: null, isLoaded: true, isSignedIn: false });
        }
      })
      .catch(() => {
        setState({ user: null, isLoaded: true, isSignedIn: false });
      });
  }, []);

  return state;
}
