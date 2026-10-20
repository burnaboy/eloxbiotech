-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailCommissionUpdates" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "emailMarketing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailOrderUpdates" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");


-- Emails are normalised before saving; the database refuses anything that isn't.
UPDATE "User" SET "email" = lower(trim("email"));
ALTER TABLE "User" ADD CONSTRAINT "User_email_normalised" CHECK ("email" = lower(trim("email")));
