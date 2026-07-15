import { Injectable } from "@nestjs/common";

@Injectable()
export class AppService {
  health() {
    return { status: "ok", service: "nod-api", time: new Date().toISOString() };
  }
}
