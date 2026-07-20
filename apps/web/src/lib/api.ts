export const API_BASE = (import.meta.env.VITE_API_URL as string) || "http://localhost:3001/api";

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    super(body?.message || `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
  if (token) localStorage.setItem("nod_access", token);
  else localStorage.removeItem("nod_access");
}

export function getAccessToken(): string | null {
  if (accessToken) return accessToken;
  accessToken = localStorage.getItem("nod_access");
  return accessToken;
}

export function getRefreshToken(): string | null {
  return localStorage.getItem("nod_refresh");
}

export function setRefreshToken(token: string | null) {
  if (token) localStorage.setItem("nod_refresh", token);
  else localStorage.removeItem("nod_refresh");
}

// Called when the refresh token is gone/invalid so the app drops to a logged-out state.
let onAuthCleared: (() => void) | null = null;
export function setOnAuthCleared(fn: (() => void) | null) {
  onAuthCleared = fn;
}
function clearAuth() {
  setAccessToken(null);
  setRefreshToken(null);
  onAuthCleared?.();
}

// Single-flight refresh: many concurrent 401s share one /auth/refresh round-trip.
let refreshInFlight: Promise<boolean> | null = null;

export function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;
    try {
      const res = await fetch(API_BASE + "/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        // Refresh token expired/revoked → hard logout.
        if (res.status === 401 || res.status === 400) clearAuth();
        return false;
      }
      const data = await res.json();
      setAccessToken(data.accessToken);
      // The server rotates the refresh token on every refresh — persist the new one.
      if (data.refreshToken) setRefreshToken(data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

// Read a response body as JSON, tolerating non-JSON payloads. A reverse proxy / gateway
// can return an HTML 502/504; JSON.parse-ing that used to throw a SyntaxError that escaped
// api()/uploadFile and crashed the caller instead of surfacing a clean ApiError.
async function parseBody(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: res.ok ? "Unexpected non-JSON response from the server." : `Server error (${res.status})` };
  }
}

async function doFetch(path: string, method: string, body: unknown, token: string | null) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(API_BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const AUTH_PATHS = ["/auth/login", "/auth/register", "/auth/refresh"];

export async function api<T = any>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const method = opts.method || "GET";
  let res = await doFetch(path, method, opts.body, getAccessToken());

  // Access token likely expired — transparently refresh once and retry.
  if (res.status === 401 && !AUTH_PATHS.some((p) => path.startsWith(p)) && getRefreshToken()) {
    const ok = await refreshAccessToken();
    if (ok) res = await doFetch(path, method, opts.body, getAccessToken());
  }

  const data = await parseBody(res);
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

// Multipart file upload → returns the served URL.
export async function uploadFile(file: File): Promise<{ url: string }> {
  const send = (token: string | null) => {
    const form = new FormData();
    form.append("file", file);
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return fetch(API_BASE + "/uploads", { method: "POST", headers, body: form });
  };
  let res = await send(getAccessToken());
  if (res.status === 401 && getRefreshToken()) {
    const ok = await refreshAccessToken();
    if (ok) res = await send(getAccessToken());
  }
  const data = await parseBody(res);
  if (!res.ok) throw new ApiError(res.status, data);
  return data as { url: string };
}
