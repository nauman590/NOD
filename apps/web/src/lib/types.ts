export type Role = "CUSTOMER" | "PROVIDER" | "ADMIN";

export interface AuthUserDto {
  id: string;
  email: string | null;
  phone: string | null;
  phoneVerified?: boolean;
  smsOptIn?: boolean;
  role: Role;
  fullName: string | null;
  profilePhotoUrl: string | null;
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
  volumeCubicYards: number;
  volumeCents: number;
  poolDistanceMiles: number;
  tripCents: number;
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
  providerPhotoUrl: string | null;
  vehicleType: string | null;
  customerId: string | null;
  customerName: string | null;
  customerPhotoUrl: string | null;
  customerRatingAvg: number;
  customerRatingCount: number;
  providerLat: number | null;
  providerLng: number | null;
  etaMinutes: number | null;
  photos: { id: string; kind: "BEFORE" | "AFTER"; url: string; takenAt: string }[];
  createdAt: string;
  claimedAt: string | null;
  enRouteAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

// A provider's completed job, with two-way rating status (Sprint 4, item 2).
export interface CompletedJob extends Job {
  providerRatedCustomer: boolean;
  providerGaveStars: number | null;
  customerRatedProvider: boolean;
  customerGaveStars: number | null;
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
  customerRatingAvg: number;
  customerRatingCount: number;
  createdAt: string;
}

export const dollars = (cents: number) => `$${Math.round(cents / 100)}`;
export const dollars2 = (cents: number) => `$${(cents / 100).toFixed(2)}`;
