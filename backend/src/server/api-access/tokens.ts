import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/server/http/rate-limit";

/**
 * Personal read-only API keys, for other apps that show your data (e.g. the
 * Pulse Check site). Shown once at creation; only the SHA-256 hash is stored.
 */
export const TOKEN_PREFIX = "vsk_";
const MAX_TOKENS = 10;

export const createTokenSchema = z.object({ name: z.string().trim().min(1).max(60) });

export async function createApiToken(userId: string, name: string) {
  const active = await db.apiToken.count({ where: { userId, revokedAt: null } });
  if (active >= MAX_TOKENS)
    throw new AppError(409, "too_many_tokens", `You can have at most ${MAX_TOKENS} API keys`);
  const token = `${TOKEN_PREFIX}${randomToken(32)}`;
  const row = await db.apiToken.create({
    data: { userId, name, tokenHash: sha256(token), tokenPrefix: token.slice(0, 10) },
    select: { id: true, name: true, tokenPrefix: true, createdAt: true },
  });
  return { ...row, token };
}

export function listApiTokens(userId: string) {
  return db.apiToken.findMany({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, tokenPrefix: true, lastUsedAt: true, createdAt: true },
  });
}

export async function revokeApiToken(userId: string, id: string) {
  const { count } = await db.apiToken.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) throw new AppError(404, "not_found", "API key not found");
}

/** Bearer vsk_… → the owning user (with a valid timezone), or 401. */
export async function authenticateApiToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token.startsWith(TOKEN_PREFIX)) throw new AppError(401, "unauthorized", "Missing API key");
  const row = await db.apiToken.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { select: { id: true, name: true, timezone: true } } },
  });
  if (!row || row.revokedAt) throw new AppError(401, "unauthorized", "API key is invalid or revoked");
  rateLimit(`apikey:${row.id}`, { perMinute: 120, burst: 30 });
  // Cheap "last used" bookkeeping: at most one write per minute per key.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await db.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  }
  return row.user;
}
