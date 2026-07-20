import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, setAccessToken, getAccessToken, setRefreshToken, setOnAuthCleared } from "./api";
import { reauthSocket, disconnectSocket } from "./socket";
import type { AuthUserDto } from "./types";

interface AuthState {
  user: AuthUserDto | null;
  loading: boolean;
  login: (emailOrPhone: string, password: string) => Promise<AuthUserDto>;
  registerProvider: (data: ProviderSignup) => Promise<AuthUserDto>;
  registerCustomer: (email: string, password: string, fullName?: string, opts?: { phone?: string; smsOptIn?: boolean }) => Promise<AuthUserDto>;
  ensureGuestCustomer: () => Promise<AuthUserDto>;
  forgotPassword: (email: string) => Promise<{ ok: true; resetUrl?: string }>;
  resetPassword: (token: string, newPassword: string) => Promise<{ ok: true }>;
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
  setRefreshToken(r.refreshToken);
  // Re-point the realtime socket at the newly-authenticated user (new rooms).
  reauthSocket();
  return r.user;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUserDto | null>(null);
  const [loading, setLoading] = useState(true);

  // If a refresh fails (token expired/revoked), api.ts calls this to drop to logged-out.
  useEffect(() => {
    setOnAuthCleared(() => {
      disconnectSocket();
      setUser(null);
    });
    return () => setOnAuthCleared(null);
  }, []);

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

  const registerCustomer = async (email: string, password: string, fullName?: string, opts?: { phone?: string; smsOptIn?: boolean }) => {
    const r = await api<any>("/auth/register/customer", {
      method: "POST",
      body: { email, password, fullName, isGuest: false, phone: opts?.phone || undefined, smsOptIn: opts?.smsOptIn },
    });
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

  // Unauthenticated: request a reset link. Backend always returns { ok: true }
  // (no account enumeration); in dev it also returns resetUrl since no mailer is wired.
  const forgotPassword = (email: string) =>
    api<{ ok: true; resetUrl?: string }>("/auth/forgot-password", { method: "POST", body: { email } });

  const resetPassword = (token: string, newPassword: string) =>
    api<{ ok: true }>("/auth/reset-password", { method: "POST", body: { token, newPassword } });

  const logout = () => {
    const refresh = localStorage.getItem("nod_refresh");
    if (refresh) api("/auth/logout", { method: "POST", body: { refreshToken: refresh } }).catch(() => {});
    setAccessToken(null);
    setRefreshToken(null);
    disconnectSocket();
    setUser(null);
  };

  return (
    <AuthCtx.Provider value={{ user, loading, login, registerProvider, registerCustomer, ensureGuestCustomer, forgotPassword, resetPassword, logout, refreshMe }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
