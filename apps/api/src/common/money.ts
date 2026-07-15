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

export const dollars = (cents: number) => Math.round(cents) / 100;
export const toCents = (dollarsValue: number) => Math.round(dollarsValue * 100);
