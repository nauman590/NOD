import { Module } from "@nestjs/common";
import { EstimateService } from "./estimate.service";
import { EstimateController } from "./estimate.controller";
import { ProvidersModule } from "../providers/providers.module";
import { AiModule } from "../ai/ai.module";
import { MapsModule } from "../maps/maps.module";

@Module({
  imports: [ProvidersModule, AiModule, MapsModule],
  providers: [EstimateService],
  controllers: [EstimateController],
  exports: [EstimateService],
})
export class EstimateModule {}
