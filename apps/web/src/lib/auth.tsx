import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, setAccessToken, getAccessToken } from "./api";
import type { AuthUserDto } from "./types";

interface AuthState {
  user: AuthUserDto | null;
  loading: boolean;
  login: (emailOrPhone: string, password: string) => Promise<AuthUserDto>;
  registerProvider: (data: ProviderSignup) => Promise<AuthUserDto>;
  registerCustomer: (email: string, password: string, fullName?: string) => Promise<AuthUserDto>;
  ensureGuestCustomer: () => Promise<AuthUserDto>;
  logout: () => void;
  refreshMe: () => Promise<void>;
}

export interface ProviderSignup {
  email: string;
  phone: string;
  password: string;
  fullName: string;
  vehicleType?: string;
}

const AuthCtx = createContext<AuthState | null>(null);

function persistTokens(r: { accessToken: string; refreshToken: string; user: AuthUserDto }) {
  setAccessToken(r.accessToken);
  localStorage.setItem("nod_refresh", r.refreshToken);
  return r.user;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUserDto | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshMe = async () => {
    if (!getAccessToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api<{ user: AuthUserDto }>("/auth/me");
      setUser(me.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshMe();
  }, []);

  const login = async (emailOrPhone: string, password: string) => {
    const r = await api<any>("/auth/login", { method: "POST", body: { emailOrPhone, password } });
    const u = persistTokens(r);
    setUser(u);
    return u;
  };

  const registerProvider = async (data: ProviderSignup) => {
    const r = await api<any>("/auth/register/provider", { method: "POST", body: data });
    const u = persistTokens(r);
    setUser(u);
    return u;
  };

  const registerCustomer = async (email: string, password: string, fullName?: string) => {
    const r = await api<any>("/auth/register/customer", { method: "POST", body: { email, password, fullName, isGuest: false } });
    const u = persistTokens(r);
    setUser(u);
    return u;
  };

  // Frictionless customer flow: if no customer session, create a guest one.
  const ensureGuestCustomer = async () => {
    if (user && user.role === "CUSTOMER") return user;
    const r = await api<any>("/auth/register/customer", { method: "POST", body: { isGuest: true } });
    const u = persistTokens(r);
    setUser(u);
    return u;
  };

  const logout = () => {
    const refresh = localStorage.getItem("nod_refresh");
    if (refresh) api("/auth/logout", { method: "POST", body: { refreshToken: refresh } }).catch(() => {});
    setAccessToken(null);
    localStorage.removeItem("nod_refresh");
    setUser(null);
  };

  return (
    <AuthCtx.Provider value={{ user, loading, login, registerProvider, registerCustomer, ensureGuestCustomer, logout, refreshMe }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
