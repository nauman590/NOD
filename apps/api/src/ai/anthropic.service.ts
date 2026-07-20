import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Anthropic from "@anthropic-ai/sdk";
import {
  EstimateAiResult,
  EstimateParams,
  ESTIMATE_SCHEMA,
  ESTIMATOR_SYSTEM_PROMPT,
  clampResult,
  heuristicEstimate,
  renderPrompt,
  resolveImageData,
} from "./estimator.shared";

export { EstimateAiResult, EstimateParams } from "./estimator.shared";

// Anthropic Claude vision estimator. When no API key is configured, `hasKey` is false
// and callers get the deterministic heuristic so the app still prices without a key.
@Injectable()
export class AnthropicEstimatorService {
  private readonly logger = new Logger(AnthropicEstimatorService.name);
  private client: Anthropic | null = null;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(private config: ConfigService) {
    const key = (config.get<string>("ANTHROPIC_API_KEY") || "").trim();
    this.model = (config.get<string>("ANTHROPIC_MODEL") || "claude-opus-4-8").trim();
    this.timeoutMs = parseInt(config.get<string>("ANTHROPIC_TIMEOUT_MS") || "20000", 10);
    if (key) {
      this.client = new Anthropic({ apiKey: key, timeout: this.timeoutMs });
      this.logger.log(`Claude vision estimator enabled (${this.model}).`);
    } else {
      this.logger.warn("ANTHROPIC_API_KEY not set — Claude estimator disabled.");
    }
  }

  get hasKey() {
    return !!this.client;
  }

  get providerName() {
    return "anthropic";
  }

  async estimate(params: EstimateParams): Promise<EstimateAiResult> {
    if (!this.client) return heuristicEstimate(params);

    const prompt = renderPrompt(params);
    const content: Anthropic.ContentBlockParam[] = [{ type: "text", text: prompt }];
    const img = await resolveImageData(params.photoUrl, this.logger);
    if (img) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: img.mediaType as any, data: img.base64 },
      });
    }

    try {
      // Thinking is left off (omitted) for low latency; structured outputs guarantee the
      // response text is JSON matching ESTIMATE_SCHEMA.
      const res = await this.client.messages.create({
        model: this.model,
        max_tokens: 700,
        system: ESTIMATOR_SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
        output_config: { format: { type: "json_schema", schema: ESTIMATE_SCHEMA } },
      });
      const raw = res.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
      if (!raw) throw new Error("empty response");
      const parsed = JSON.parse(raw) as EstimateAiResult;
      return clampResult({ ...parsed, source: "ai" }, params.minHours, params.maxHours);
    } catch (e) {
      this.logger.warn(`Claude estimate failed (${(e as Error).message}) — falling back to heuristic.`);
      return heuristicEstimate(params);
    }
  }
}
