import { Logger } from "@nestjs/common";

// Shared contract + helpers for the AI pricing estimator, so the OpenAI and
// Anthropic (Claude) vision providers stay byte-for-byte identical in the pieces
// that must match (schema, prompt rendering, clamping, and the deterministic
// heuristic fallback). Only the model call itself differs per provider.

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

export interface EstimateParams {
  promptTemplate: string;
  description: string;
  intake: Record<string, unknown>;
  photoUrl?: string | null;
  distanceMiles?: number;
  driveTimeHours?: number;
  minHours: number;
  maxHours: number;
}

// Structured-output schema. Every object sets additionalProperties:false and lists
// every property in `required`, and uses only enums (no min/max / string length) —
// the intersection of what BOTH Anthropic structured outputs and OpenAI strict
// json_schema accept, so one schema drives both providers.
export const ESTIMATE_SCHEMA = {
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
} as const;

export const ESTIMATOR_SYSTEM_PROMPT = "You are a precise on-demand-services pricing estimator.";

export function renderPrompt(params: EstimateParams): string {
  return params.promptTemplate
    .replace("{{description}}", params.description || "(none)")
    .replace("{{intakeJson}}", JSON.stringify(params.intake || {}))
    .replace("{{distanceMiles}}", String(params.distanceMiles ?? "n/a"))
    .replace("{{driveTimeHours}}", String(params.driveTimeHours ?? "n/a"));
}

const SUPPORTED_IMAGE = /^image\/(jpeg|png|webp|gif)$/;

// SSRF guard for server-side image fetches. The ONLY remote URL the app ever generates
// for a photo is its own uploads endpoint (POST /api/uploads → `${PUBLIC_API_URL}/uploads/…`),
// so we allow exactly that origin + path and refuse everything else. Without this, a
// caller could set photoUrl to http://169.254.169.254/… (cloud metadata) or any internal
// host and have the server fetch it. `data:` URIs never reach here (handled before fetch).
function isAllowedImageUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const selfBase = (process.env.PUBLIC_API_URL || "http://localhost:3001").replace(/\/+$/, "");
  let self: URL;
  try {
    self = new URL(selfBase);
  } catch {
    return false;
  }
  // Same origin as our own API, and only paths under the static uploads prefix. URL()
  // normalises `..` traversal, so a normalised path must still start with /uploads/.
  return u.protocol === self.protocol && u.host === self.host && u.pathname.startsWith("/uploads/");
}

// Turn a photoUrl into raw base64 image bytes usable by either provider. Local upload
// URLs (e.g. http://localhost:3001/uploads/…) aren't reachable by the model providers'
// servers, so we fetch the bytes ourselves and inline them. Unsupported types → null.
export async function resolveImageData(
  photoUrl: string | null | undefined,
  logger?: Logger,
): Promise<{ mediaType: string; base64: string } | null> {
  if (!photoUrl) return null;
  try {
    if (photoUrl.startsWith("data:")) {
      const m = photoUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!m || !SUPPORTED_IMAGE.test(m[1])) return null;
      return { mediaType: m[1], base64: m[2] };
    }
    if (/^https?:\/\//.test(photoUrl)) {
      if (!isAllowedImageUrl(photoUrl)) {
        logger?.warn(`Refusing to fetch estimate image from a non-allowlisted URL (SSRF guard) — estimating without it.`);
        return null;
      }
      const res = await fetch(photoUrl);
      if (!res.ok) return null;
      const mediaType = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
      if (!SUPPORTED_IMAGE.test(mediaType)) return null;
      const base64 = Buffer.from(await res.arrayBuffer()).toString("base64");
      return { mediaType, base64 };
    }
    return null;
  } catch (e) {
    logger?.warn(`Could not load estimate image (${(e as Error).message}) — estimating without it.`);
    return null;
  }
}

export function clampResult(r: EstimateAiResult, minHours: number, maxHours: number): EstimateAiResult {
  let hours = Number(r.estimatedHours);
  if (!isFinite(hours) || hours <= 0) hours = minHours;
  hours = Math.min(Math.max(hours, minHours), maxHours);
  const confidence = Math.min(Math.max(Number(r.confidence) || 0.5, 0), 1);
  const addOns = (r.suggestedAddOns || [])
    .filter((a) => a && a.description && a.amount > 0 && a.amount < 2000)
    .slice(0, 6);
  return { ...r, estimatedHours: hours, confidence, suggestedAddOns: addOns };
}

// Deterministic heuristic used when no API key is set, on provider failure, or when
// the provider misses the display-latency SLA. Keeps the app pricing without a key.
export function heuristicEstimate(params: EstimateParams): EstimateAiResult {
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
