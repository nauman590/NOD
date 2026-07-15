-- AlterEnum
ALTER TYPE "StrikeReason" ADD VALUE 'LATE_ARRIVAL';

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "delayNoticeAt" TIMESTAMP(3),
ADD COLUMN     "latePenaltyCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Provider" ADD COLUMN     "depositPaymentIntentId" TEXT,
ADD COLUMN     "depositRefundedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "suspendedReason" TEXT,
ADD COLUMN     "suspendedUntil" TIMESTAMP(3);
