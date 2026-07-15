import { Injectable } from "@nestjs/common";
import { Server } from "socket.io";

// Thin emitter so feature services don't import the gateway (avoids circular deps).
// The gateway sets `server` in afterInit.
@Injectable()
export class RealtimeService {
  private server: Server | null = null;

  setServer(server: Server) {
    this.server = server;
  }

  emit(room: string, event: string, payload: unknown) {
    this.server?.to(room).emit(event, payload);
  }

  // Room helpers
  providerRoom = (providerId: string) => `provider:${providerId}`;
  categoryRoom = (categoryId: string) => `category:${categoryId}`;
  customerRoom = (customerId: string) => `customer:${customerId}`;
  jobRoom = (jobId: string) => `job:${jobId}`;
  adminRoom = () => "admin:global";
}
