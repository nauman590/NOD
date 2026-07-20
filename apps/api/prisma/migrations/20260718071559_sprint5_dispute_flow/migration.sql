-- AlterEnum
ALTER TYPE "PaymentType" ADD VALUE 'DISPUTE_CHARGE';

-- CreateTable
CREATE TABLE "DisputePhoto" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeClawback" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeClawback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DisputePhoto_disputeId_idx" ON "DisputePhoto"("disputeId");

-- CreateIndex
CREATE INDEX "DisputeClawback_providerId_settledAt_idx" ON "DisputeClawback"("providerId", "settledAt");

-- AddForeignKey
ALTER TABLE "DisputePhoto" ADD CONSTRAINT "DisputePhoto_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputePhoto" ADD CONSTRAINT "DisputePhoto_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeClawback" ADD CONSTRAINT "DisputeClawback_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeClawback" ADD CONSTRAINT "DisputeClawback_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
