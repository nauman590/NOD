import { PrismaClient, Role, ProviderStatus, JobStatus, PaymentType, PaymentStatus } from "@prisma/client";
import * as bcrypt from "bcryptjs";

// Realistic demo dataset: real Atlanta addresses, varied jobs across statuses with
// ratings + payouts so the dashboard/analytics/provider feeds look like a live market.
// Idempotent: job history is only created once (latched by a marker user).
const prisma = new PrismaClient();

const DEMO_PW = "demo1234";
const fee = (b: number) => Math.round(b * 0.18);
const net = (b: number) => b - fee(b);
const daysAgo = (n: number, h = 10) => new Date(Date.now() - n * 86400000 + h * 3600000);
const pick = <T>(arr: T[], i: number) => arr[i % arr.length];

async function upsertUser(email: string, fullName: string, role: Role) {
  const passwordHash = await bcrypt.hash(DEMO_PW, 10);
  return prisma.user.upsert({
    where: { email },
    update: { fullName, role, passwordHash, isGuest: false },
    create: { email, fullName, role, passwordHash, phoneVerified: true },
  });
}

async function ensureProvider(userId: string, vehicleType: string, bio: string, rates: Record<string, number>, catMap: Record<string, string>) {
  const p = await prisma.provider.upsert({
    where: { userId },
    update: { status: ProviderStatus.ACTIVE, vehicleType, bio, backgroundCheckStatus: "PASSED", approvedAt: new Date() },
    create: { userId, status: ProviderStatus.ACTIVE, vehicleType, bio, backgroundCheckStatus: "PASSED", approvedAt: new Date() },
  });
  for (const [slug, rate] of Object.entries(rates)) {
    if (!catMap[slug]) continue;
    await prisma.providerCategoryRate.upsert({
      where: { providerId_categoryId: { providerId: p.id, categoryId: catMap[slug] } },
      update: { hourlyRateCents: rate, active: true },
      create: { providerId: p.id, categoryId: catMap[slug], hourlyRateCents: rate, active: true },
    });
  }
  return p;
}

async function main() {
  const cats = await prisma.category.findMany();
  const catMap: Record<string, string> = {};
  cats.forEach((c) => (catMap[c.slug] = c.id));

  // ---- Demo login accounts (the provided emails) ----
  const admin = await upsertUser("naumannaseer590@gmail.com", "Nauman (Admin)", Role.ADMIN);
  const proUser1 = await upsertUser("naumantech35@gmail.com", "Nauman Tech Movers", Role.PROVIDER);
  const proUser2 = await upsertUser("naumannaseer5900@gmail.com", "Naseer Haul & Handy", Role.PROVIDER);
  const demoCustomer = await upsertUser("naumannaseer59000@gmail.com", "Nauman Naseer", Role.CUSTOMER);

  await ensureProvider(proUser1.id, "Ford F-150 Pickup", "10+ yrs hauling & furniture moves across metro Atlanta.", { junk: 7000, furniture: 8000 }, catMap);
  await ensureProvider(proUser2.id, "Mercedes Cargo Van", "Same-day delivery and handyman pro. TV mounts, assembly, hauling.", { delivery: 5500, handyman: 9000 }, catMap);

  // ---- Extra realistic customers ----
  const custDefs = [
    ["sarah.mitchell.atl@gmail.com", "Sarah Mitchell"],
    ["david.chen.atl@gmail.com", "David Chen"],
    ["aisha.patel.atl@gmail.com", "Aisha Patel"],
    ["marcus.johnson.atl@gmail.com", "Marcus Johnson"],
    ["emily.rodriguez.atl@gmail.com", "Emily Rodriguez"],
    ["james.park.atl@gmail.com", "James Park"],
    ["olivia.brooks.atl@gmail.com", "Olivia Brooks"],
  ];
  const customers = [demoCustomer];
  for (const [e, n] of custDefs) customers.push(await upsertUser(e, n, Role.CUSTOMER));

  // ---- Idempotency latch ----
  const MARKER = "__demo_history__@nod.app";
  if (await prisma.user.findUnique({ where: { email: MARKER } })) {
    console.log("Demo accounts refreshed. Job history already seeded — skipping.");
    return;
  }

  // ---- Provider pool by category (demo providers + existing seeded ACTIVE) ----
  const provs = await prisma.provider.findMany({
    where: { status: ProviderStatus.ACTIVE },
    include: { user: true, categoryRates: true },
  });
  const bySlug: Record<string, typeof provs> = { junk: [], furniture: [], delivery: [], handyman: [] };
  for (const p of provs) for (const r of p.categoryRates) {
    const slug = cats.find((c) => c.id === r.categoryId)?.slug;
    if (slug && bySlug[slug]) bySlug[slug].push(p);
  }

  const ADDRESSES = [
    "1280 Peachtree St NE, Atlanta, GA 30309",
    "675 Ponce De Leon Ave NE, Atlanta, GA 30308",
    "3393 Peachtree Rd NE, Atlanta, GA 30326",
    "800 Highland Ave NE, Atlanta, GA 30306",
    "1100 Howell Mill Rd NW, Atlanta, GA 30318",
    "2 Decatur Square, Decatur, GA 30030",
    "5901 Peachtree Dunwoody Rd, Sandy Springs, GA 30328",
    "1197 Peachtree St NE, Atlanta, GA 30361",
    "215 Ponce De Leon Ave, Decatur, GA 30030",
    "933 Lee St SW, Atlanta, GA 30310",
  ];

  // status, category, description, basePrice($), daysAgo, stars(if completed)
  const J = (status: JobStatus, cat: string, desc: string, price: number, days: number, stars?: number) =>
    ({ status, cat, desc, cents: price * 100, days, stars });

  const jobs = [
    // completed (with ratings + payouts)
    J("COMPLETE", "junk", "Old sectional sofa, a broken dresser, and ~12 moving boxes in the basement", 165, 13, 5),
    J("COMPLETE", "junk", "Garage cleanout — 2 mattresses, an exercise bike, and misc junk", 210, 12, 5),
    J("COMPLETE", "furniture", "Move a queen bed, dresser and dining set from a 2nd-floor walk-up to a townhouse", 280, 11, 4),
    J("COMPLETE", "handyman", "Mount a 65\" TV over the fireplace and conceal the cables", 180, 10, 5),
    J("COMPLETE", "delivery", "Pick up a dresser from West Elm (Lenox) and deliver to a Midtown apartment", 95, 9, 5),
    J("COMPLETE", "handyman", "Assemble two IKEA PAX wardrobes and a bookshelf", 220, 8, 4),
    J("COMPLETE", "junk", "Single-item pickup: refrigerator haul-away from a 1st-floor unit", 120, 7, 5),
    J("COMPLETE", "delivery", "Home Depot run — 12 bags of mulch, 2 boxes of pavers", 110, 6, 4),
    J("COMPLETE", "furniture", "Relocate a 3-seat sectional and a wardrobe across town", 240, 5, 5),
    J("COMPLETE", "handyman", "Replace a leaking kitchen faucet and re-caulk the sink", 140, 4, 5),
    J("COMPLETE", "junk", "Post-renovation debris: drywall offcuts, old cabinets, ~6 bags", 195, 3, 4),
    J("COMPLETE", "delivery", "Marketplace pickup — a solid oak desk delivered to Decatur", 85, 2, 5),
    // active
    J("IN_PROGRESS", "furniture", "Studio move: bed, couch, TV stand and 15 boxes to a new apartment", 300, 0, undefined),
    J("EN_ROUTE", "junk", "Backyard cleanup — old shed materials and a rusted swing set", 175, 0, undefined),
    J("CLAIMED", "handyman", "Hang 6 framed pictures and install two floating shelves", 110, 0, undefined),
    // available (provider feed)
    J("AVAILABLE", "delivery", "Costco run — bulk groceries and a 55\" TV to Buckhead", 90, 0, undefined),
    J("AVAILABLE", "junk", "Apartment cleanout before move-out — couch, table, several bags", 160, 0, undefined),
    J("AVAILABLE", "handyman", "Assemble a crib and a changing table; baby-proof two cabinets", 130, 0, undefined),
    // cancelled + dispute
    J("CANCELLED", "delivery", "Furniture delivery — cancelled before a pro went en route", 75, 6, undefined),
    J("COMPLETE", "junk", "Estate cleanout — multiple rooms of old furniture and boxes", 320, 5, 3),
  ];

  let created = 0, idx = 0;
  for (const j of jobs) {
    const customer = pick(customers, idx);
    const pool = bySlug[j.cat] || [];
    const assigned = j.status === "AVAILABLE" ? null : pool.length ? pick(pool, idx) : null;
    const ts = daysAgo(j.days);

    const job = await prisma.job.create({
      data: {
        customerId: customer.id,
        categoryId: catMap[j.cat],
        providerId: assigned?.id ?? null,
        status: j.status,
        description: j.desc,
        serviceAddress: pick(ADDRESSES, idx),
        basePriceCents: j.cents,
        estimatedHours: Math.max(0.5, Math.round((j.cents / 7000) * 2) / 2),
        intakeData: { seed: "demo" } as any,
        createdAt: ts,
        claimedAt: assigned ? new Date(ts.getTime() + 3 * 60000) : null,
        enRouteAt: ["EN_ROUTE", "IN_PROGRESS", "COMPLETE"].includes(j.status) ? new Date(ts.getTime() + 30 * 60000) : null,
        arrivedAt: ["IN_PROGRESS", "COMPLETE"].includes(j.status) ? new Date(ts.getTime() + 60 * 60000) : null,
        startedAt: ["IN_PROGRESS", "COMPLETE"].includes(j.status) ? new Date(ts.getTime() + 65 * 60000) : null,
        completedAt: j.status === "COMPLETE" ? new Date(ts.getTime() + 150 * 60000) : null,
        cancelledAt: j.status === "CANCELLED" ? new Date(ts.getTime() + 20 * 60000) : null,
        cancellationTier: j.status === "CANCELLED" ? "AFTER_CLAIM" : null,
        cancelledBy: j.status === "CANCELLED" ? "CUSTOMER" : null,
      },
    });

    if (j.status === "COMPLETE" && assigned) {
      await prisma.payment.create({
        data: { jobId: job.id, userId: customer.id, type: PaymentType.BASE, status: PaymentStatus.CAPTURED,
          amountCents: j.cents, platformFeeCents: fee(j.cents), providerNetCents: net(j.cents), capturedAt: job.completedAt },
      });
      await prisma.payment.create({
        data: { jobId: job.id, userId: assigned.userId, type: PaymentType.PAYOUT, status: PaymentStatus.CAPTURED,
          amountCents: net(j.cents), platformFeeCents: 0, providerNetCents: net(j.cents), capturedAt: job.completedAt },
      });
      if (j.stars) {
        await prisma.rating.create({ data: { jobId: job.id, raterId: customer.id, rateeId: assigned.userId, stars: j.stars, comment: j.stars >= 5 ? "Fast, friendly, great work!" : j.stars === 4 ? "Good job, on time." : "Job done but a bit late." } });
        await prisma.rating.create({ data: { jobId: job.id, raterId: assigned.userId, rateeId: customer.id, stars: 5, comment: "Easy customer, clear access." } });
      }
    }
    created++; idx++;
  }

  // Recompute provider rating aggregates from the seeded ratings.
  for (const p of provs) {
    const agg = await prisma.rating.aggregate({ where: { rateeId: p.userId }, _avg: { stars: true }, _count: true });
    if (agg._count > 0) await prisma.provider.update({ where: { id: p.id }, data: { ratingAvg: agg._avg.stars ?? 0, ratingCount: agg._count } });
  }

  await prisma.user.create({ data: { email: MARKER, role: Role.CUSTOMER, isGuest: true } });
  console.log(`Demo seed complete: ${customers.length} customers, ${jobs.length} jobs (${created}), ratings + payouts written.`);
  console.log("Demo logins (password: " + DEMO_PW + "):");
  console.log("  ADMIN    naumannaseer590@gmail.com");
  console.log("  PROVIDER naumantech35@gmail.com");
  console.log("  PROVIDER naumannaseer5900@gmail.com");
  console.log("  CUSTOMER naumannaseer59000@gmail.com");
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
