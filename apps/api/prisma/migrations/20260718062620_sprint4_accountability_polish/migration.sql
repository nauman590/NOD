-- CreateEnum
CREATE TYPE "OffPlatformReportStatus" AS ENUM ('PENDING', 'VERIFIED', 'DISMISSED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "customerRatingAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "customerRatingCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "profilePhotoUrl" TEXT;

-- CreateTable
CREATE TABLE "OffPlatformReport" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "reporterId" TEXT NOT NULL,
    "reportedUserId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidenceUrl" TEXT,
    "status" "OffPlatformReportStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "banApplied" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OffPlatformReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OffPlatformReport_status_idx" ON "OffPlatformReport"("status");

-- CreateIndex
CREATE INDEX "OffPlatformReport_reportedUserId_idx" ON "OffPlatformReport"("reportedUserId");

-- AddForeignKey
ALTER TABLE "OffPlatformReport" ADD CONSTRAINT "OffPlatformReport_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OffPlatformReport" ADD CONSTRAINT "OffPlatformReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OffPlatformReport" ADD CONSTRAINT "OffPlatformReport_reportedUserId_fkey" FOREIGN KEY ("reportedUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
