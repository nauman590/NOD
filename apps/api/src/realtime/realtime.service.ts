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

  // Move every socket currently in `srcRoom` into `dstRoom` (e.g. a provider who
  // just claimed a job should start receiving that job room's events immediately).
  joinRoomToRoom(srcRoom: string, dstRoom: string) {
    this.server?.in(srcRoom).socketsJoin(dstRoom);
  }

  // Room helpers
  providerRoom = (providerId: string) => `provider:${providerId}`;
  categoryRoom = (categoryId: string) => `category:${categoryId}`;
  customerRoom = (customerId: string) => `customer:${customerId}`;
  jobRoom = (jobId: string) => `job:${jobId}`;
  adminRoom = () => "admin:global";
  // Per-user room (any role) so notifications can target a user by id.
  userRoom = (userId: string) => `user:${userId}`;
}
