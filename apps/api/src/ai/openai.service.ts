import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";
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

// OpenAI GPT-4o vision estimator. Mirrors the Claude estimator exactly (same schema,
// prompt, clamping, and heuristic fallback) — only the model call differs. When no
// OPENAI_API_KEY is configured, `hasKey` is false and callers get the heuristic.
@Injectable()
export class OpenAiEstimatorService {
  private readonly logger = new Logger(OpenAiEstimatorService.name);
  private client: OpenAI | null = null;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(private config: ConfigService) {
    const key = (config.get<string>("OPENAI_API_KEY") || "").trim();
    this.model = (config.get<string>("OPENAI_MODEL") || "gpt-4o-mini").trim();
    this.timeoutMs = parseInt(config.get<string>("OPENAI_TIMEOUT_MS") || "20000", 10);
    if (key) {
      this.client = new OpenAI({ apiKey: key, timeout: this.timeoutMs });
      this.logger.log(`OpenAI vision estimator enabled (${this.model}).`);
    } else {
      this.logger.warn("OPENAI_API_KEY not set — OpenAI estimator disabled.");
    }
  }

  get hasKey() {
    return !!this.client;
  }

  get providerName() {
    return "openai";
  }

  async estimate(params: EstimateParams): Promise<EstimateAiResult> {
    if (!this.client) return heuristicEstimate(params);

    const prompt = renderPrompt(params);
    const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      { type: "text", text: prompt },
    ];
    const img = await resolveImageData(params.photoUrl, this.logger);
    if (img) {
      userContent.push({
        type: "image_url",
        image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
      });
    }

    try {
      // Strict json_schema response format guarantees the content is JSON matching
      // ESTIMATE_SCHEMA (gpt-4o supports Structured Outputs).
      const res = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 700,
        messages: [
          { role: "system", content: ESTIMATOR_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "estimate", strict: true, schema: ESTIMATE_SCHEMA as any },
        },
      });
      const raw = res.choices[0]?.message?.content;
      if (!raw) throw new Error("empty response");
      const parsed = JSON.parse(raw) as EstimateAiResult;
      return clampResult({ ...parsed, source: "ai" }, params.minHours, params.maxHours);
    } catch (e) {
      this.logger.warn(`OpenAI estimate failed (${(e as Error).message}) — falling back to heuristic.`);
      return heuristicEstimate(params);
    }
  }
}
