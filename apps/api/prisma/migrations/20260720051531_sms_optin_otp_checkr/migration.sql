-- AlterTable
ALTER TABLE "Provider" ADD COLUMN     "checkrCandidateId" TEXT,
ADD COLUMN     "checkrReportId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phoneOtpExpiresAt" TIMESTAMP(3),
ADD COLUMN     "phoneOtpHash" TEXT,
ADD COLUMN     "smsOptIn" BOOLEAN NOT NULL DEFAULT true;
