import { PrismaClient, Role, ProviderStatus, PaymentStatus } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const SHARED_SUFFIX =
  "Return ONLY JSON matching the provided schema. If the photo does not depict the stated category, " +
  "set confidence below 0.4, estimatedHours to the category minimum, and suggestedAddOns to []. " +
  "Never invent items you cannot see. All amounts are in USD.";

const CATEGORIES = [
  {
    slug: "junk",
    name: "Junk removal",
    sortOrder: 1,
    baseFeeCents: 1500,
    disposalFeeCents: 2000,
    perMileFeeCents: 0,
    fallbackHourlyRateCents: 6000,
    minHours: 0.5,
    maxHours: 8,
    promptTemplate:
      "You are a junk-removal estimator. From the photo and description, estimate the total junk " +
      "volume in cubic yards and the labor hours for a 2-person crew to load and haul it. Count discrete " +
      "items and classify each by size. Heavier/bulkier loads and stairs/walk-ups increase hours. Set " +
      "volumeCubicYards to your volume estimate, estimatedHours to crew labor hours, and complexity from " +
      "access difficulty and weight. Suggest add-ons only for special handling (mattress/appliance/e-waste/" +
      'hazardous disposal surcharges). Customer note: "{{description}}". Intake: {{intakeJson}}. ' +
      SHARED_SUFFIX,
    intakeConfig: {
      addressMode: "single",
      fields: [
        { key: "itemCount", label: "Roughly how many items?", type: "number", required: false, feedsEstimate: true, affects: "hours" },
        { key: "floors", label: "Which floor / walk-up?", type: "select", options: [
          { value: "ground", label: "Ground floor" },
          { value: "1-2", label: "1–2 flights" },
          { value: "3+", label: "3+ flights" },
        ], required: false, feedsEstimate: true, affects: "access" },
      ],
    },
  },
  {
    slug: "furniture",
    name: "Furniture move",
    sortOrder: 2,
    baseFeeCents: 2000,
    disposalFeeCents: 0,
    perMileFeeCents: 0,
    fallbackHourlyRateCents: 7000,
    minHours: 1,
    maxHours: 10,
    promptTemplate:
      "You are a furniture-moving estimator. Estimate labor hours for a 2-person crew to move the depicted " +
      "furniture, factoring item count, size/weight, disassembly, and the access details provided (floor, " +
      "elevator/stairs, distance to truck). Do NOT include driving time. Set estimatedHours accordingly and " +
      "complexity from access + bulk. Suggest add-ons only for disassembly/reassembly, hoisting, or specialty " +
      'items (piano, safe). Customer note: "{{description}}". Intake: {{intakeJson}}. ' +
      SHARED_SUFFIX,
    intakeConfig: {
      addressMode: "pickup_dropoff",
      fields: [
        { key: "floor", label: "Which floor?", type: "select", options: [
          { value: "1", label: "1st" }, { value: "2", label: "2nd" }, { value: "3+", label: "3rd+" },
        ], required: false, feedsEstimate: true, affects: "access" },
        { key: "hasElevator", label: "Elevator available?", type: "boolean", required: false, feedsEstimate: true, affects: "access" },
        { key: "disassembly", label: "Disassembly needed?", type: "boolean", required: false, feedsEstimate: true, affects: "hours" },
      ],
    },
  },
  {
    slug: "delivery",
    name: "Delivery / pickup",
    sortOrder: 3,
    baseFeeCents: 1000,
    disposalFeeCents: 0,
    perMileFeeCents: 150,
    fallbackHourlyRateCents: 5000,
    minHours: 0.25,
    maxHours: 6,
    promptTemplate:
      "You are a delivery estimator. The driving distance and drive-time have been computed for you: " +
      "{{distanceMiles}} miles, {{driveTimeHours}} hours. From the photo and description, estimate only the " +
      "handling hours to load at pickup and unload at dropoff (do NOT re-estimate driving time). Factor item " +
      "count, size, and whether help/equipment is needed. Set estimatedHours to handling hours only. Suggest " +
      "add-ons only for oversized items, multiple flights of stairs, or assembly. Customer note: " +
      '"{{description}}". Intake: {{intakeJson}}. ' +
      SHARED_SUFFIX,
    intakeConfig: {
      addressMode: "pickup_dropoff",
      fields: [
        { key: "itemsFitInCar", label: "Will it fit in a car?", type: "boolean", required: false, feedsEstimate: true, affects: "hours" },
        { key: "helpNeeded", label: "Need a second person?", type: "boolean", required: false, feedsEstimate: true, affects: "hours" },
      ],
    },
  },
  {
    slug: "handyman",
    name: "Handyman small jobs",
    sortOrder: 4,
    baseFeeCents: 0,
    disposalFeeCents: 0,
    perMileFeeCents: 0,
    fallbackHourlyRateCents: 8000,
    minHours: 0.5,
    maxHours: 8,
    promptTemplate:
      "You are a handyman-job estimator. From the photo and description, identify the task(s) and estimate " +
      "labor hours for one pro, with complexity reflecting tools, skill, and uncertainty. Be conservative; if " +
      "the scope is ambiguous, lower confidence rather than guessing high. Set estimatedHours and list any " +
      "clearly-needed materials as suggestedAddOns (materials are billed to the customer and paid to the " +
      'provider). Customer note: "{{description}}". Intake: {{intakeJson}}. ' +
      SHARED_SUFFIX,
    intakeConfig: {
      addressMode: "single",
      fields: [
        { key: "taskType", label: "What kind of task?", type: "text", required: false, feedsEstimate: true, affects: "hours" },
      ],
    },
  },
];

async function main() {
  // Admin
  const adminPw = await bcrypt.hash("admin1234", 10);
  const admin = await prisma.user.upsert({
    where: { email: "admin@nod.app" },
    update: {},
    create: { email: "admin@nod.app", passwordHash: adminPw, role: Role.ADMIN, fullName: "NOD Admin", phoneVerified: true },
  });
  console.log("admin:", admin.email, "(pw: admin1234)");

  // Categories
  const cats: Record<string, string> = {};
  for (const c of CATEGORIES) {
    const cat = await prisma.category.upsert({
      where: { slug: c.slug },
      update: {
        name: c.name, sortOrder: c.sortOrder, promptTemplate: c.promptTemplate,
        intakeConfig: c.intakeConfig as any, baseFeeCents: c.baseFeeCents, disposalFeeCents: c.disposalFeeCents,
        perMileFeeCents: c.perMileFeeCents, fallbackHourlyRateCents: c.fallbackHourlyRateCents,
        minHours: c.minHours, maxHours: c.maxHours,
      },
      create: {
        slug: c.slug, name: c.name, sortOrder: c.sortOrder, promptTemplate: c.promptTemplate,
        intakeConfig: c.intakeConfig as any, baseFeeCents: c.baseFeeCents, disposalFeeCents: c.disposalFeeCents,
        perMileFeeCents: c.perMileFeeCents, fallbackHourlyRateCents: c.fallbackHourlyRateCents,
        minHours: c.minHours, maxHours: c.maxHours,
      },
    });
    cats[c.slug] = cat.id;
  }
  console.log("categories:", Object.keys(cats).join(", "));

  // Test providers
  const providerSeed = [
    { email: "pro1@nod.app", name: "Marcus (Hauler)", vehicle: "Pickup truck", rates: { junk: 6500, furniture: 7500 } },
    { email: "pro2@nod.app", name: "Tasha (Courier)", vehicle: "Cargo van", rates: { delivery: 5500, handyman: 8500 } },
    { email: "pro3@nod.app", name: "Dee (All-rounder)", vehicle: "SUV", rates: { junk: 5500, delivery: 4800, handyman: 7800 } },
  ];
  const proPw = await bcrypt.hash("provider1234", 10);
  for (const p of providerSeed) {
    const user = await prisma.user.upsert({
      where: { email: p.email },
      update: {},
      create: { email: p.email, passwordHash: proPw, role: Role.PROVIDER, fullName: p.name, phoneVerified: true },
    });
    const provider = await prisma.provider.upsert({
      where: { userId: user.id },
      // Seed a funded $50 deposit so the demo still works if REQUIRE_DEPOSIT_TO_CLAIM is on.
      update: { status: ProviderStatus.ACTIVE, depositStatus: PaymentStatus.CAPTURED, depositBalanceCents: 5000 },
      create: {
        userId: user.id, status: ProviderStatus.ACTIVE, vehicleType: p.vehicle,
        backgroundCheckStatus: "STUB_PASSED", approvedAt: new Date(),
        depositStatus: PaymentStatus.CAPTURED, depositBalanceCents: 5000,
      },
    });
    for (const [slug, rate] of Object.entries(p.rates)) {
      await prisma.providerCategoryRate.upsert({
        where: { providerId_categoryId: { providerId: provider.id, categoryId: cats[slug] } },
        update: { hourlyRateCents: rate, active: true },
        create: { providerId: provider.id, categoryId: cats[slug], hourlyRateCents: rate, active: true },
      });
    }
  }
  console.log("providers:", providerSeed.map((p) => p.email).join(", "), "(pw: provider1234)");

  // Sample customer
  const custPw = await bcrypt.hash("customer1234", 10);
  await prisma.user.upsert({
    where: { email: "customer@nod.app" },
    update: {},
    create: { email: "customer@nod.app", passwordHash: custPw, role: Role.CUSTOMER, fullName: "Sample Customer", phoneVerified: true },
  });
  console.log("customer: customer@nod.app (pw: customer1234)");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
