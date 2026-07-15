import { PrismaClient, Role, ProviderStatus } from "@prisma/client";
import * as bcrypt from "bcryptjs";

// Production top-up seed: 5 ACTIVE providers per category (run AFTER `prisma db seed`,
// which creates the admin + categories). Idempotent via upserts.
const prisma = new PrismaClient();

const FIRST_NAMES = ["Marcus", "Tasha", "Dee", "Priya", "Jordan", "Lena", "Carlos", "Amara", "Wes", "Nina", "Omar", "Riley", "Sofia", "Kwame", "Hana", "Theo", "Bianca", "Sam", "Yuki", "Andre"];
const VEHICLES = ["Pickup truck", "Cargo van", "SUV", "Box truck", "Trailer"];

async function main() {
  const cats = await prisma.category.findMany({ orderBy: { sortOrder: "asc" } });
  if (cats.length === 0) throw new Error("No categories found — run `prisma db seed` first.");

  const proPw = await bcrypt.hash("provider1234", 10);
  let n = 0;

  for (const cat of cats) {
    for (let i = 1; i <= 5; i++) {
      const email = `${cat.slug}-pro${i}@nod.app`;
      const name = `${FIRST_NAMES[n % FIRST_NAMES.length]} (${cat.name})`;
      const user = await prisma.user.upsert({
        where: { email },
        update: {},
        create: { email, passwordHash: proPw, role: Role.PROVIDER, fullName: name, phoneVerified: true },
      });
      const provider = await prisma.provider.upsert({
        where: { userId: user.id },
        update: { status: ProviderStatus.ACTIVE },
        create: {
          userId: user.id,
          status: ProviderStatus.ACTIVE,
          vehicleType: VEHICLES[(n) % VEHICLES.length],
          backgroundCheckStatus: "STUB_PASSED",
          approvedAt: new Date(),
        },
      });
      // Spread rates around the category fallback so the AI estimate has a realistic average.
      const rate = cat.fallbackHourlyRateCents + (i - 3) * 500;
      await prisma.providerCategoryRate.upsert({
        where: { providerId_categoryId: { providerId: provider.id, categoryId: cat.id } },
        update: { hourlyRateCents: rate, active: true },
        create: { providerId: provider.id, categoryId: cat.id, hourlyRateCents: rate, active: true },
      });
      n++;
    }
    console.log(`  ${cat.slug}: 5 providers (${cat.slug}-pro1..5@nod.app)`);
  }
  console.log(`Seeded ${n} active providers across ${cats.length} categories (pw: provider1234)`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
