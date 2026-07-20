import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { ProvidersService } from "../providers/providers.service";
import { EstimatorService } from "../ai/estimator.service";
import { MapsService } from "../maps/maps.service";
import { platformFee, toCents, volumePriceCents, complexityMultiplier } from "../common/money";
import { CreateEstimateDto } from "./dto";

const LOCK_MINUTES = 15;

@Injectable()
export class EstimateService {
  constructor(
    private prisma: PrismaService,
    private providers: ProvidersService,
    private ai: EstimatorService,
    private maps: MapsService,
    private config: ConfigService,
  ) {}

  async create(dto: CreateEstimateDto, customerId?: string) {
    const category = await this.prisma.category.findUnique({ where: { slug: dto.categorySlug } });
    if (!category) throw new NotFoundException("category not found");

    const intake = dto.intakeData ?? {};
    const intakeConfig = category.intakeConfig as any;
    const isDelivery = intakeConfig?.addressMode === "pickup_dropoff";

    // Delivery distance feeds the price: compute from pickup/dropoff via Maps when a
    // key is present, otherwise use a provided distance or a sensible default.
    let distanceMiles: number | undefined;
    let driveTimeHours: number | undefined;
    if (isDelivery) {
      distanceMiles =
        dto.distanceMiles ??
        (await this.maps.distanceMiles(dto.pickupAddress, dto.dropoffAddress, 6));
      driveTimeHours = Math.round((distanceMiles / 25) * 100) / 100; // ~25mph city avg
    }

    const ai = await this.ai.estimate({
      promptTemplate: category.promptTemplate,
      description: dto.description,
      intake,
      photoUrl: dto.photoUrl ?? null,
      distanceMiles,
      driveTimeHours,
      minHours: category.minHours,
      maxHours: category.maxHours,
    });

    // Pricing: hours × avg active-provider rate + per-category fees.
    const avgFromMarket = await this.providers.avgHourlyRateCents(category.id);
    const avgRateCents = avgFromMarket ?? category.fallbackHourlyRateCents;
    const rateSource = avgFromMarket !== null ? "market" : "fallback";

    // Per-category price levers: handyman scales labor by complexity; junk adds a real
    // volume charge from the AI's cubic-yard estimate (previously cosmetic values).
    const complexityFactor = category.slug === "handyman" ? complexityMultiplier(ai.complexity) : 1;
    const volumeCents = category.slug === "junk" ? volumePriceCents(ai.volumeCubicYards) : 0;

    const laborHours = isDelivery ? ai.estimatedHours + (driveTimeHours ?? 0) : ai.estimatedHours;
    const laborCents = Math.round(laborHours * avgRateCents * complexityFactor);
    const mileageCents = isDelivery ? Math.round((distanceMiles ?? 0) * category.perMileFeeCents) : 0;

    // Provider-pool → customer distance feeds the estimate (AI Pricing Engine). The pool
    // dispatches from SERVICE_HUB_ADDRESS; the trip to the customer is a per-mile fee.
    const customerLocation = isDelivery ? dto.pickupAddress : (dto.serviceAddress ?? undefined);
    const poolDistanceMiles = await this.maps.poolDistanceMiles(customerLocation);
    const tripFeePerMileCents = parseInt(this.config.get<string>("TRIP_FEE_PER_MILE_CENTS") || "150", 10);
    const tripCents = Math.round(poolDistanceMiles * tripFeePerMileCents);

    const baseFeeCents = category.baseFeeCents;
    const disposalFeeCents = category.disposalFeeCents;

    const basePriceCents = laborCents + volumeCents + tripCents + mileageCents + baseFeeCents + disposalFeeCents;

    const breakdown = {
      estimatedHours: ai.estimatedHours,
      driveTimeHours: driveTimeHours ?? 0,
      avgRateCents,
      rateSource,
      laborCents,
      complexityFactor,
      volumeCubicYards: ai.volumeCubicYards,
      volumeCents,
      poolDistanceMiles,
      tripCents,
      mileageCents,
      baseFeeCents,
      disposalFeeCents,
      platformFeeCents: platformFee(basePriceCents),
      complexity: ai.complexity,
      confidence: ai.confidence,
      estimateSource: ai.source,
    };

    const suggestedAddOns = ai.suggestedAddOns.map((a) => ({
      description: a.description,
      priceCents: toCents(a.amount),
    }));

    const inputsHash = crypto
      .createHash("sha256")
      .update(JSON.stringify({ slug: dto.categorySlug, description: dto.description, intake, distanceMiles }))
      .digest("hex");

    const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);

    const estimate = await this.prisma.estimate.create({
      data: {
        categoryId: category.id,
        customerId: customerId ?? null,
        photoUrl: dto.photoUrl ?? null,
        description: dto.description,
        intakeData: intake as any,
        serviceAddress:
          dto.serviceAddress ??
          (isDelivery && dto.pickupAddress
            ? `Pickup: ${dto.pickupAddress}${dto.dropoffAddress ? ` → Dropoff: ${dto.dropoffAddress}` : ""}`
            : null),
        distanceMiles: distanceMiles ?? null,
        estimatedHours: ai.estimatedHours,
        avgRateCents,
        rateSource,
        estimateSource: ai.source,
        basePriceCents,
        breakdown: breakdown as any,
        suggestedAddOns: suggestedAddOns as any,
        lockedUntil,
        inputsHash,
      },
    });

    return {
      estimateId: estimate.id,
      categorySlug: category.slug,
      categoryName: category.name,
      basePriceCents,
      breakdown,
      suggestedAddOns,
      lockedUntil,
      lockMinutes: LOCK_MINUTES,
    };
  }

  async get(id: string) {
    const estimate = await this.prisma.estimate.findUnique({ where: { id } });
    if (!estimate) throw new NotFoundException("estimate not found");
    return estimate;
  }
}
