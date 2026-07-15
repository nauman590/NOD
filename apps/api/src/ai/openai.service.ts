import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";

export interface EstimateAiResult {
  estimatedHours: number;
  complexity: "low" | "medium" | "high";
  detectedItems: { label: string; count: number; size: "small" | "medium" | "large" | "xlarge" }[];
  itemCount: number;
  volumeCubicYards: number;
  suggestedAddOns: { description: string; amount: number }[];
  confidence: number;
  reasoning: string;
  categoryHint: string;
  source: "ai" | "fallback";
}

const ESTIMATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    estimatedHours: { type: "number" },
    complexity: { type: "string", enum: ["low", "medium", "high"] },
    detectedItems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          count: { type: "number" },
          size: { type: "string", enum: ["small", "medium", "large", "xlarge"] },
        },
        required: ["label", "count", "size"],
      },
    },
    itemCount: { type: "number" },
    volumeCubicYards: { type: "number" },
    suggestedAddOns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { description: { type: "string" }, amount: { type: "number" } },
        required: ["description", "amount"],
      },
    },
    confidence: { type: "number" },
    reasoning: { type: "string" },
    categoryHint: { type: "string" },
  },
  required: [
    "estimatedHours", "complexity", "detectedItems", "itemCount",
    "volumeCubicYards", "suggestedAddOns", "confidence", "reasoning", "categoryHint",
  ],
};

@Injectable()
export class OpenAiService {
  private readonly logger = new Logger(OpenAiService.name);
  private client: OpenAI | null = null;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(private config: ConfigService) {
    const key = config.get<string>("OPENAI_API_KEY");
    this.model = config.get<string>("OPENAI_MODEL") || "gpt-4o";
    this.timeoutMs = parseInt(config.get<string>("OPENAI_TIMEOUT_MS") || "5000", 10);
    if (key && key.trim()) {
      this.client = new OpenAI({ apiKey: key, timeout: this.timeoutMs });
    } else {
      this.logger.warn("OPENAI_API_KEY not set — using heuristic estimator fallback.");
    }
  }

  get hasKey() {
    return !!this.client;
  }

  async estimate(params: {
    promptTemplate: string;
    description: string;
    intake: Record<string, unknown>;
    photoUrl?: string | null;
    distanceMiles?: number;
    driveTimeHours?: number;
    minHours: number;
    maxHours: number;
  }): Promise<EstimateAiResult> {
    if (!this.client) return this.heuristic(params);

    const prompt = params.promptTemplate
      .replace("{{description}}", params.description || "(none)")
      .replace("{{intakeJson}}", JSON.stringify(params.intake || {}))
      .replace("{{distanceMiles}}", String(params.distanceMiles ?? "n/a"))
      .replace("{{driveTimeHours}}", String(params.driveTimeHours ?? "n/a"));

    const userContent: any[] = [{ type: "text", text: prompt }];
    if (params.photoUrl && /^https?:\/\//.test(params.photoUrl)) {
      userContent.push({ type: "image_url", image_url: { url: params.photoUrl, detail: "low" } });
    } else if (params.photoUrl && params.photoUrl.startsWith("data:")) {
      userContent.push({ type: "image_url", image_url: { url: params.photoUrl, detail: "low" } });
    }

    try {
      const res = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0.2,
        max_tokens: 600,
        messages: [
          { role: "system", content: "You are a precise on-demand-services pricing estimator." },
          { role: "user", content: userContent },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "nod_estimate", strict: true, schema: ESTIMATE_SCHEMA as any },
        },
      });
      const raw = res.choices[0]?.message?.content;
      if (!raw) throw new Error("empty response");
      const parsed = JSON.parse(raw) as EstimateAiResult;
      return this.clamp({ ...parsed, source: "ai" }, params.minHours, params.maxHours);
    } catch (e) {
      this.logger.warn(`OpenAI estimate failed (${(e as Error).message}) — falling back to heuristic.`);
      return this.heuristic(params);
    }
  }

  private clamp(r: EstimateAiResult, minHours: number, maxHours: number): EstimateAiResult {
    let hours = Number(r.estimatedHours);
    if (!isFinite(hours) || hours <= 0) hours = minHours;
    hours = Math.min(Math.max(hours, minHours), maxHours);
    const confidence = Math.min(Math.max(Number(r.confidence) || 0.5, 0), 1);
    const addOns = (r.suggestedAddOns || [])
      .filter((a) => a && a.description && a.amount > 0 && a.amount < 2000)
      .slice(0, 6);
    return { ...r, estimatedHours: hours, confidence, suggestedAddOns: addOns };
  }

  // Deterministic heuristic used when no API key or on AI failure.
  private heuristic(params: {
    description: string;
    intake: Record<string, unknown>;
    minHours: number;
    maxHours: number;
    distanceMiles?: number;
  }): EstimateAiResult {
    const len = (params.description || "").trim().length;
    let hours = params.minHours + Math.min(len, 240) / 90; // ~0.5–3.2h from detail
    if (params.intake) {
      const v = JSON.stringify(params.intake).toLowerCase();
      if (v.includes("3+") || v.includes('"true"') || v.includes("disassembly")) hours += 0.75;
    }
    hours = Math.min(Math.max(hours, params.minHours), params.maxHours);
    return {
      estimatedHours: Math.round(hours * 4) / 4,
      complexity: hours > 3 ? "high" : hours > 1.5 ? "medium" : "low",
      detectedItems: [],
      itemCount: 0,
      volumeCubicYards: 0,
      suggestedAddOns: [],
      confidence: 0.5,
      reasoning: "Heuristic estimate (AI unavailable).",
      categoryHint: "",
      source: "fallback",
    };
  }
}
