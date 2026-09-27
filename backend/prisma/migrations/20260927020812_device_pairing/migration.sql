/*
  Warnings:

  - You are about to drop the column `pairingCodeHash` on the `ingest_device` table. All the data in the column will be lost.
  - You are about to drop the column `pairingExpiresAt` on the `ingest_device` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "PairingStatus" AS ENUM ('PENDING', 'APPROVED', 'CONSUMED');

-- DropIndex
DROP INDEX "ingest_device_pairingCodeHash_key";

-- AlterTable
ALTER TABLE "ingest_device" DROP COLUMN "pairingCodeHash",
DROP COLUMN "pairingExpiresAt";

-- CreateTable
CREATE TABLE "device_pairing" (
    "id" TEXT NOT NULL,
    "deviceCodeHash" TEXT NOT NULL,
    "userCodeHash" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "deviceModel" TEXT,
    "status" "PairingStatus" NOT NULL DEFAULT 'PENDING',
    "userId" TEXT,
    "ingestDeviceId" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastPolledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_pairing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_pairing_deviceCodeHash_key" ON "device_pairing"("deviceCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "device_pairing_userCodeHash_key" ON "device_pairing"("userCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "device_pairing_ingestDeviceId_key" ON "device_pairing"("ingestDeviceId");

-- CreateIndex
CREATE INDEX "device_pairing_expiresAt_idx" ON "device_pairing"("expiresAt");

-- AddForeignKey
ALTER TABLE "device_pairing" ADD CONSTRAINT "device_pairing_ingestDeviceId_fkey" FOREIGN KEY ("ingestDeviceId") REFERENCES "ingest_device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
