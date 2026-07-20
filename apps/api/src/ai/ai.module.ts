import { Module } from "@nestjs/common";
import { AnthropicEstimatorService } from "./anthropic.service";
import { OpenAiEstimatorService } from "./openai.service";
import { EstimatorService } from "./estimator.service";

// Provider-flexible AI pricing module. EstimatorService is the single injectable
// callers depend on; it dispatches to OpenAI or Claude (or the heuristic) per config.
@Module({
  providers: [OpenAiEstimatorService, AnthropicEstimatorService, EstimatorService],
  exports: [EstimatorService],
})
export class AiModule {}
