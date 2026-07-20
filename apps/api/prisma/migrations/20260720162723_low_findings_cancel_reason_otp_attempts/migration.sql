-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "cancellationReason" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phoneOtpAttempts" INTEGER NOT NULL DEFAULT 0;
