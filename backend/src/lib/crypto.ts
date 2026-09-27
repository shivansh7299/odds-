import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * AES-256-GCM envelope for secrets stored at rest (third-party OAuth tokens).
 *
 * Layout: [version:1][iv:12][authTag:16][ciphertext:n]
 * The version byte selects the key, so keys can be rotated without re-encrypting
 * every row at once.
 */
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_LENGTH = 1 + IV_LENGTH + TAG_LENGTH;

export type KeyRing = {
  current: { version: number; key: Buffer };
  previous?: { version: number; key: Buffer };
};

export function encryptSecret(plaintext: string, ring: KeyRing): Buffer {
  const { version, key } = ring.current;
  if (version < 1 || version > 255) throw new Error("Key version must be 1–255");
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([version]), iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptSecret(payload: Uint8Array, ring: KeyRing): string {
  const buf = Buffer.from(payload);
  if (buf.length < HEADER_LENGTH) throw new Error("Ciphertext too short");
  const version = buf[0];
  const entry = [ring.current, ring.previous].find((k) => k?.version === version);
  if (!entry) throw new Error(`No key for version ${version}`);

  const iv = buf.subarray(1, 1 + IV_LENGTH);
  const tag = buf.subarray(1 + IV_LENGTH, HEADER_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", entry.key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(buf.subarray(HEADER_LENGTH)), decipher.final()]).toString("utf8");
}

/** Random URL-safe token, e.g. device bearer tokens. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** SHA-256 hex digest — for storing bearer tokens / pairing codes we only need to compare. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
