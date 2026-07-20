import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AnthropicEstimatorService } from "./anthropic.service";
import { OpenAiEstimatorService } from "./openai.service";
import { EstimateAiResult, EstimateParams, heuristicEstimate } from "./estimator.shared";

export { EstimateAiResult, EstimateParams } from "./estimator.shared";

type ProviderName = "openai" | "anthropic" | "heuristic";

// Provider-flexible AI pricing dispatcher.
//   AI_PROVIDER=auto (default) → use Claude if ANTHROPIC_API_KEY is set, else OpenAI if
//                                OPENAI_API_KEY is set, else the deterministic heuristic.
//   AI_PROVIDER=openai|anthropic|heuristic → force that provider.
// The brief requires the price to display within 5 seconds; AI_SLA_MS (default 5000)
// bounds the wait — if the live model doesn't answer in time, we return the instant
// heuristic so the customer always gets a price on schedule. Set AI_SLA_MS=0 to
// always wait for the model (disables the SLA race, e.g. for verification).
@Injectable()
export class EstimatorService {
  private readonly logger = new Logger(EstimatorService.name);
  private readonly provider: ProviderName;
  private readonly slaMs: number;

  constructor(
    private config: ConfigService,
    private openai: OpenAiEstimatorService,
    private anthropic: AnthropicEstimatorService,
  ) {
    const configured = (config.get<string>("AI_PROVIDER") || "auto").trim().toLowerCase();
    this.slaMs = parseInt(config.get<string>("AI_SLA_MS") || "5000", 10);
    this.provider = this.resolveProvider(configured);
    this.logger.log(
      `AI pricing provider: ${this.provider}` +
        (configured === "auto" ? " (auto-detected)" : ` (forced via AI_PROVIDER=${configured})`) +
        (this.provider !== "heuristic" && this.slaMs > 0 ? ` — ${this.slaMs}ms display SLA` : ""),
    );
  }

  private resolveProvider(configured: string): ProviderName {
    if (configured === "openai") return this.openai.hasKey ? "openai" : "heuristic";
    if (configured === "anthropic" || configured === "claude")
      return this.anthropic.hasKey ? "anthropic" : "heuristic";
    if (configured === "heuristic") return "heuristic";
    // auto: prefer Claude, then OpenAI, then heuristic.
    if (this.anthropic.hasKey) return "anthropic";
    if (this.openai.hasKey) return "openai";
    return "heuristic";
  }

  /** Which real model is wired (or "heuristic" when none). Surfaced for diagnostics. */
  get activeProvider(): ProviderName {
    return this.provider;
  }

  /** True when a real vision model is configured and will be used. */
  get modelEnabled(): boolean {
    return this.provider !== "heuristic";
  }

  async estimate(params: EstimateParams): Promise<EstimateAiResult> {
    if (this.provider === "heuristic") return heuristicEstimate(params);

    const call =
      this.provider === "openai" ? this.openai.estimate(params) : this.anthropic.estimate(params);

    // No SLA race → await the model fully.
    if (this.slaMs <= 0) return call;

    // Race the model against the display SLA; heuristic wins if the model is too slow.
    let timer: NodeJS.Timeout;
    const sla = new Promise<EstimateAiResult>((resolve) => {
      timer = setTimeout(() => {
        this.logger.warn(
          `AI estimate exceeded ${this.slaMs}ms SLA — returning heuristic to meet display deadline.`,
        );
        resolve(heuristicEstimate(params));
      }, this.slaMs);
    });
    try {
      return await Promise.race([call, sla]);
    } finally {
      clearTimeout(timer!);
    }
  }
}
