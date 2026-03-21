import { useState, useEffect, useCallback } from "react";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: string;
}

interface AuthState {
  authenticated: boolean;
  user: AuthUser | null;
  loading: boolean;
}

let cachedState: AuthState | null = null;
let listeners: Array<() => void> = [];

function notifyListeners() {
  listeners.forEach((l) => l());
}

export function useAuth() {
  const [state, setState] = useState<AuthState>(
    cachedState || { authenticated: false, user: null, loading: true },
  );

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      const data = await res.json();
      const newState: AuthState = {
        authenticated: data.authenticated,
        user: data.user || null,
        loading: false,
      };
      cachedState = newState;
      setState(newState);
      notifyListeners();
    } catch {
      const newState: AuthState = { authenticated: false, user: null, loading: false };
      cachedState = newState;
      setState(newState);
      notifyListeners();
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
    }
    cachedState = { authenticated: false, user: null, loading: false };
    setState(cachedState);
    notifyListeners();
    window.location.href = import.meta.env.BASE_URL + "login";
  }, []);

  useEffect(() => {
    const listener = () => {
      if (cachedState) setState(cachedState);
    };
    listeners.push(listener);

    if (!cachedState) {
      refresh();
    }

    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  }, [refresh]);

  return { ...state, refresh, logout };
}
