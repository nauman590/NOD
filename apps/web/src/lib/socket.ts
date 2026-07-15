import { io, Socket } from "socket.io-client";
import { useEffect } from "react";
import { API_BASE, getAccessToken } from "./api";

const SOCKET_URL = API_BASE.replace(/\/api$/, "") + "/realtime";

let socket: Socket | null = null;

export function getSocket(): Socket | null {
  const token = getAccessToken();
  if (!token) return null;
  if (socket && socket.connected) return socket;
  if (!socket) {
    socket = io(SOCKET_URL, { auth: { token }, autoConnect: true, transports: ["websocket"] });
  } else {
    socket.auth = { token };
    if (!socket.connected) socket.connect();
  }
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

// Subscribe to a server event for the lifetime of the component.
export function useSocketEvent(event: string, handler: (payload: any) => void) {
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    s.on(event, handler);
    return () => {
      s.off(event, handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);
}
