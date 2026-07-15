export type Role = "CUSTOMER" | "PROVIDER" | "ADMIN";

export interface AuthUserDto {
  id: string;
  email: string | null;
  phone: string | null;
  role: Role;
  fullName: string | null;
  isGuest: boolean;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  intakeConfig: {
    addressMode: "single" | "pickup_dropoff";
    fields: {
      key: string;
      label: string;
      type: "text" | "number" | "select" | "boolean" | "multiselect";
      options?: { value: string; label: string }[];
      required?: boolean;
      feedsEstimate?: boolean;
    }[];
  };
  baseFeeCents: number;
  disposalFeeCents: number;
}

export interface EstimateBreakdown {
  estimatedHours: number;
  driveTimeHours: number;
  avgRateCents: number;
  rateSource: "market" | "fallback";
  laborCents: number;
  mileageCents: number;
  baseFeeCents: number;
  disposalFeeCents: number;
  platformFeeCents: number;
  complexity: string;
  confidence: number;
  estimateSource: "ai" | "fallback";
}

export interface EstimateResult {
  estimateId: string;
  categorySlug: string;
  categoryName: string;
  basePriceCents: number;
  breakdown: EstimateBreakdown;
  suggestedAddOns: { description: string; priceCents: number }[];
  lockedUntil: string;
  lockMinutes: number;
}

export type JobStatus =
  | "AVAILABLE" | "CLAIMED" | "PENDING_APPROVAL" | "APPROVED" | "DECLINED"
  | "EN_ROUTE" | "ARRIVED" | "IN_PROGRESS" | "COMPLETE" | "CANCELLED";

export interface AddOn {
  id: string;
  description: string;
  priceCents: number;
  status: "PENDING" | "APPROVED" | "DECLINED";
}

export interface Job {
  id: string;
  status: JobStatus;
  category: string | null;
  categorySlug: string | null;
  categoryId: string;
  photoUrl: string | null;
  description: string;
  serviceAddress: string | null;
  distanceMiles: number | null;
  estimatedHours: number | null;
  basePriceCents: number;
  addOns: AddOn[];
  approvedAddOnsCents: number;
  pendingAddOnsCents: number;
  customerTotalCents: number;
  providerPayoutCents: number;
  providerName: string | null;
  providerId: string | null;
  customerId: string | null;
  providerLat: number | null;
  providerLng: number | null;
  etaMinutes: number | null;
  photos: { id: string; kind: "BEFORE" | "AFTER"; url: string; takenAt: string }[];
  createdAt: string;
  claimedAt: string | null;
  completedAt: string | null;
}

export interface JobCard {
  id: string;
  category: string | null;
  categoryId: string;
  description: string;
  photoUrl: string | null;
  distanceMiles: number | null;
  basePriceCents: number;
  providerPayoutCents: number;
  serviceAddress: string | null;
  status: JobStatus;
  createdAt: string;
}

export const dollars = (cents: number) => `$${Math.round(cents / 100)}`;
export const dollars2 = (cents: number) => `$${(cents / 100).toFixed(2)}`;
