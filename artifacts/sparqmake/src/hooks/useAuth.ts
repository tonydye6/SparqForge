import { apiFetch } from "@/lib/utils";
import { useState, useEffect, useCallback, createContext, useContext } from "react";
import type { ReactNode } from "react";
import { createElement } from "react";

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

interface AuthContextValue extends AuthState {
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const API_BASE = import.meta.env.VITE_API_URL || "";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    authenticated: false,
    user: null,
    loading: true,
  });

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/auth/me`, { credentials: "include" });
      const data = await res.json();
      setState({
        authenticated: data.authenticated,
        user: data.user || null,
        loading: false,
      });
    } catch {
      setState({ authenticated: false, user: null, loading: false });
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch(`${API_BASE}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {}
    setState({ authenticated: false, user: null, loading: false });
    window.location.href = import.meta.env.BASE_URL + "login";
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return createElement(
    AuthContext.Provider,
    { value: { ...state, refresh, logout } },
    children,
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
