-- AlterEnum
ALTER TYPE "PaymentType" ADD VALUE 'DEPOSIT_DEDUCTION';

-- AlterTable
ALTER TABLE "Provider" ADD COLUMN     "depositBalanceCents" INTEGER;
