import { io, Socket } from "socket.io-client";
import { useEffect, useRef } from "react";
import { API_BASE, getAccessToken, getRefreshToken, refreshAccessToken } from "./api";

const SOCKET_URL = API_BASE.replace(/\/api$/, "") + "/realtime";

let socket: Socket | null = null;

// Auth is a FUNCTION so socket.io re-reads the *current* access token on every
// (re)connection attempt — a stale token after a reconnect was the old bug.
function buildSocket(): Socket {
  const s = io(SOCKET_URL, {
    auth: (cb) => cb({ token: getAccessToken() }),
    autoConnect: true,
    transports: ["websocket", "polling"],
  });

  // If the handshake was rejected because the access token expired, refresh the
  // token and reconnect. Guard against a tight loop when there's no refresh token.
  s.on("connect_error", async () => {
    if (s.connected) return;
    if (!getRefreshToken()) return;
    const ok = await refreshAccessToken();
    if (ok && !s.connected) s.connect();
  });

  return s;
}

export function getSocket(): Socket | null {
  if (!getAccessToken()) return null;
  if (!socket) socket = buildSocket();
  else if (!socket.connected) socket.connect();
  return socket;
}

export function disconnectSocket() {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
}

// Identity changed (login / register / guest upgrade): force a fresh handshake on
// the SAME socket instance so it re-joins the new user's rooms while keeping every
// component's event subscriptions intact. Falls back to creating the socket.
export function reauthSocket() {
  if (!socket) {
    getSocket();
    return;
  }
  socket.disconnect();
  if (getAccessToken()) socket.connect();
}

// Subscribe to a server event for the lifetime of the component.
// - handler is kept in a ref so it's never stale (no need to list it as a dep)
// - if the socket isn't ready yet at mount, retry until it is
export function useSocketEvent(event: string, handler: (payload: any) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const wrapper = (payload: any) => handlerRef.current(payload);
    let bound: Socket | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;

    const bind = () => {
      const s = getSocket();
      if (!s) return false;
      bound = s;
      s.on(event, wrapper);
      return true;
    };

    if (!bind()) {
      // Socket not available yet (token still loading) — retry briefly.
      poll = setInterval(() => {
        if (bind() && poll) {
          clearInterval(poll);
          poll = null;
        }
      }, 500);
    }

    return () => {
      if (poll) clearInterval(poll);
      bound?.off(event, wrapper);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);
}
