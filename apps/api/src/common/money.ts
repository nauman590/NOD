// Centralized money math (integer cents). Mirrors apps/web/src/lib/provider-store.ts:
// platform fee = 18% of base, provider keeps 82% of base + 100% of approved add-ons.

export const PLATFORM_FEE_RATE = 0.18;

export function platformFee(baseCents: number): number {
  return Math.round(baseCents * PLATFORM_FEE_RATE);
}

export function providerBaseNet(baseCents: number): number {
  return baseCents - platformFee(baseCents);
}

export function addOnsTotal(addOns: { priceCents: number }[]): number {
  return addOns.reduce((sum, a) => sum + (a.priceCents || 0), 0);
}

export function customerTotal(baseCents: number, addOns: { priceCents: number }[]): number {
  return baseCents + addOnsTotal(addOns);
}

export function providerPayout(
  baseCents: number,
  approvedAddOns: { priceCents: number }[],
  cancellationFeesOwedCents = 0,
): number {
  return providerBaseNet(baseCents) + addOnsTotal(approvedAddOns) + cancellationFeesOwedCents;
}

// ---- Per-category price levers (Sprint 3) ----
// Junk removal is partly volume-priced: the AI's cubic-yard estimate becomes a real
// charge on top of crew labor. Handyman scales labor by the AI's complexity read.
export const CUBIC_YARD_RATE_CENTS = 1200; // $12 per estimated cubic yard

export function volumePriceCents(cubicYards: number): number {
  return Math.round(Math.max(0, cubicYards || 0) * CUBIC_YARD_RATE_CENTS);
}

export function complexityMultiplier(complexity: "low" | "medium" | "high"): number {
  if (complexity === "high") return 1.2;
  if (complexity === "low") return 0.9;
  return 1.0; // medium / unknown
}

// ---- Provider claim-and-no-show penalty (Sprint 4) ----
// A provider who claims a job and then no-shows owes a flat penalty deducted from
// their next payout (plus a strike). Product spec pins this at $15–$25; the exact
// value is configurable via PROVIDER_NO_SHOW_FEE_CENTS but always clamped to range.
export const PROVIDER_NO_SHOW_FEE_MIN_CENTS = 1500;
export const PROVIDER_NO_SHOW_FEE_MAX_CENTS = 2500;
export const PROVIDER_NO_SHOW_FEE_DEFAULT_CENTS = 2000;

export function clampNoShowFeeCents(cents: number): number {
  if (!Number.isFinite(cents)) return PROVIDER_NO_SHOW_FEE_DEFAULT_CENTS;
  return Math.min(PROVIDER_NO_SHOW_FEE_MAX_CENTS, Math.max(PROVIDER_NO_SHOW_FEE_MIN_CENTS, Math.round(cents)));
}

export const dollars = (cents: number) => Math.round(cents) / 100;
export const toCents = (dollarsValue: number) => Math.round(dollarsValue * 100);
