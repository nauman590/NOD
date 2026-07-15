-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "estimateId" TEXT;

-- CreateTable
CREATE TABLE "Estimate" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "customerId" TEXT,
    "photoUrl" TEXT,
    "description" TEXT NOT NULL,
    "intakeData" JSONB,
    "serviceAddress" TEXT,
    "distanceMiles" DOUBLE PRECISION,
    "estimatedHours" DOUBLE PRECISION NOT NULL,
    "avgRateCents" INTEGER NOT NULL,
    "rateSource" TEXT NOT NULL,
    "estimateSource" TEXT NOT NULL,
    "basePriceCents" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "suggestedAddOns" JSONB,
    "lockedUntil" TIMESTAMP(3) NOT NULL,
    "inputsHash" TEXT NOT NULL,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Estimate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Estimate_categoryId_idx" ON "Estimate"("categoryId");

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
