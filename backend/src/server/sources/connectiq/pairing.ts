import "server-only";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { realtimeBus } from "@/server/realtime/pg-bus";

/**
 * Device authorization for the Connect IQ watch app (RFC 8628 shape):
 *   watch  → start: gets a secret device code + a short user code to display
 *   user   → approve: types the user code on the Sources page (signed in)
 *   watch  → poll: exchanges the device code for a long-lived bearer token, once
 * Only SHA-256 hashes of codes and tokens are stored.
 */
export const PAIRING_TTL_SEC = 600;
export const POLL_INTERVAL_SEC = 5;
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

export const normalizeUserCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

function newUserCode(): string {
  const raw = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export const startSchema = z.object({
  name: z.string().trim().min(1).max(40).default("Garmin watch"),
  model: z.string().trim().max(40).optional(),
});

export async function startPairing(input: z.infer<typeof startSchema>) {
  const deviceCode = randomToken(32);
  const userCode = newUserCode();
  await db.devicePairing.create({
    data: {
      deviceCodeHash: sha256(deviceCode),
      userCodeHash: sha256(normalizeUserCode(userCode)),
      deviceName: input.name,
      deviceModel: input.model,
      expiresAt: new Date(Date.now() + PAIRING_TTL_SEC * 1000),
    },
  });
  return {
    deviceCode,
    userCode,
    verificationUrl: `${env().BETTER_AUTH_URL.replace(/\/$/, "")}/sources`,
    expiresIn: PAIRING_TTL_SEC,
    interval: POLL_INTERVAL_SEC,
  };
}

export const approveSchema = z.object({
  userCode: z.string().trim().min(8).max(12),
  name: z.string().trim().min(1).max(40).optional(),
});

export async function approvePairing(user: { id: string }, input: z.infer<typeof approveSchema>) {
  const pairing = await db.devicePairing.findUnique({
    where: { userCodeHash: sha256(normalizeUserCode(input.userCode)) },
  });
  if (!pairing || pairing.status !== "PENDING" || pairing.expiresAt < new Date()) {
    throw new AppError(
      404,
      "invalid_code",
      "That code is wrong or expired. Start pairing again on the watch.",
    );
  }

  const conn = await db.sourceConnection.upsert({
    where: { userId_source: { userId: user.id, source: "GARMIN_CONNECTIQ" } },
    create: { userId: user.id, source: "GARMIN_CONNECTIQ", status: "ACTIVE" },
    update: {},
  });
  const device = await db.$transaction(async (tx) => {
    // Conditional update so two concurrent approvals can't both succeed.
    const claimed = await tx.devicePairing.updateMany({
      where: { id: pairing.id, status: "PENDING" },
      data: { status: "APPROVED", userId: user.id },
    });
    if (claimed.count === 0) throw new AppError(409, "already_used", "This code was already used.");
    const d = await tx.ingestDevice.create({
      data: {
        userId: user.id,
        connectionId: conn.id,
        name: input.name ?? pairing.deviceName,
        model: pairing.deviceModel,
      },
    });
    await tx.devicePairing.update({ where: { id: pairing.id }, data: { ingestDeviceId: d.id } });
    return d;
  });
  await realtimeBus.publish(user.id, { kind: "source", source: "GARMIN_CONNECTIQ" });
  return { id: device.id, name: device.name };
}

export const pollSchema = z.object({ deviceCode: z.string().min(20).max(100) });

export type PollResult =
  | { status: "pending"; interval: number }
  | { status: "slow_down"; interval: number }
  | { status: "approved"; token: string; deviceId: string };

export async function pollPairing({ deviceCode }: z.infer<typeof pollSchema>): Promise<PollResult> {
  const pairing = await db.devicePairing.findUnique({ where: { deviceCodeHash: sha256(deviceCode) } });
  if (!pairing) throw new AppError(400, "invalid_grant", "Unknown device code");
  if (pairing.status === "CONSUMED")
    throw new AppError(410, "already_issued", "Token already issued. Pair again.");
  if (pairing.expiresAt < new Date() && pairing.status === "PENDING") {
    throw new AppError(410, "expired_token", "Pairing code expired. Start again.");
  }

  const now = new Date();
  const tooFast =
    pairing.lastPolledAt && now.getTime() - pairing.lastPolledAt.getTime() < (POLL_INTERVAL_SEC - 1) * 1000;
  await db.devicePairing.update({ where: { id: pairing.id }, data: { lastPolledAt: now } });
  if (tooFast) return { status: "slow_down", interval: POLL_INTERVAL_SEC * 2 };
  if (pairing.status === "PENDING") return { status: "pending", interval: POLL_INTERVAL_SEC };

  // APPROVED → issue the token exactly once.
  const token = `vs_${randomToken(32)}`;
  const issued = await db.devicePairing.updateMany({
    where: { id: pairing.id, status: "APPROVED" },
    data: { status: "CONSUMED" },
  });
  if (issued.count === 0) throw new AppError(410, "already_issued", "Token already issued. Pair again.");
  await db.ingestDevice.update({
    where: { id: pairing.ingestDeviceId! },
    data: { tokenHash: sha256(token), tokenPrefix: token.slice(0, 8) },
  });
  return { status: "approved", token, deviceId: pairing.ingestDeviceId! };
}

export async function listDevices(userId: string) {
  return db.ingestDevice.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      model: true,
      tokenPrefix: true,
      lastSeenAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
}

export async function revokeDevice(userId: string, id: string) {
  const { count } = await db.ingestDevice.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date(), tokenHash: null },
  });
  if (count === 0) throw new AppError(404, "not_found", "Device not found");
  await realtimeBus.publish(userId, { kind: "source", source: "GARMIN_CONNECTIQ" });
}

/** Resolves a watch's bearer token to its device + owner, or throws 401. */
export async function authenticateDevice(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token.startsWith("vs_")) throw new AppError(401, "unauthorized", "Missing device token");
  const device = await db.ingestDevice.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { select: { id: true, timezone: true } } },
  });
  if (!device || device.revokedAt)
    throw new AppError(401, "unauthorized", "Device token is invalid or revoked");
  return device;
}
