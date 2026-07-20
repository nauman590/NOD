import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { Server, Socket } from "socket.io";
import { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeService } from "./realtime.service";

const CORS_ENV = (process.env.CORS_ORIGINS || "http://localhost:5173").trim();
const GATEWAY_CORS = { origin: CORS_ENV === "*" ? true : CORS_ENV.split(",").map((s) => s.trim()), credentials: true };

@WebSocketGateway({ namespace: "/realtime", cors: GATEWAY_CORS })
export class EventsGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer() server!: Server;

  constructor(
    private jwt: JwtService,
    private config: ConfigService,
    private prisma: PrismaService,
    private realtime: RealtimeService,
  ) {}

  afterInit(server: Server) {
    this.realtime.setServer(server);
  }

  async handleConnection(socket: Socket) {
    try {
      const token = socket.handshake.auth?.token || (socket.handshake.query?.token as string);
      if (!token) {
        socket.disconnect(true);
        return;
      }
      const payload = await this.jwt.verifyAsync(token, {
        secret: this.config.get<string>("JWT_ACCESS_SECRET") || "dev_access_secret_change_me",
      });
      const userId: string = payload.sub;
      const role: Role = payload.role;
      socket.data.userId = userId;
      socket.data.role = role;

      // Every socket joins its per-user room so notifications can reach the user by id.
      socket.join(this.realtime.userRoom(userId));

      if (role === Role.ADMIN) {
        socket.join(this.realtime.adminRoom());
      } else if (role === Role.PROVIDER) {
        const provider = await this.prisma.provider.findUnique({
          where: { userId },
          include: { categoryRates: { where: { active: true } } },
        });
        if (provider) {
          socket.join(this.realtime.providerRoom(provider.id));
          for (const r of provider.categoryRates) socket.join(this.realtime.categoryRoom(r.categoryId));
          // join active job rooms
          const jobs = await this.prisma.job.findMany({
            where: { providerId: provider.id, status: { notIn: ["COMPLETE", "CANCELLED"] } },
            select: { id: true },
          });
          for (const j of jobs) socket.join(this.realtime.jobRoom(j.id));
        }
      } else {
        socket.join(this.realtime.customerRoom(userId));
        const jobs = await this.prisma.job.findMany({
          where: { customerId: userId, status: { notIn: ["COMPLETE", "CANCELLED"] } },
          select: { id: true },
        });
        for (const j of jobs) socket.join(this.realtime.jobRoom(j.id));
      }
      socket.emit("connected", { ok: true });
    } catch {
      socket.disconnect(true);
    }
  }

  // Provider broadcasts GPS while working (Phase 3 maps; wired now so it flows end-to-end).
  @SubscribeMessage("provider:location")
  async onLocation(@ConnectedSocket() socket: Socket, @MessageBody() data: { jobId: string; lat: number; lng: number }) {
    if (socket.data.role !== Role.PROVIDER) return;
    this.realtime.emit(this.realtime.jobRoom(data.jobId), "provider.location", {
      jobId: data.jobId,
      lat: data.lat,
      lng: data.lng,
      ts: Date.now(),
    });
  }

  // Allow a client to explicitly join a job room (e.g. after creating/claiming a job mid-session).
  @SubscribeMessage("job:subscribe")
  onJobSubscribe(@ConnectedSocket() socket: Socket, @MessageBody() data: { jobId: string }) {
    socket.join(this.realtime.jobRoom(data.jobId));
    return { ok: true };
  }
}
