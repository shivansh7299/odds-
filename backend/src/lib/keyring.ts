import "server-only";
import { env } from "@/lib/env";
import type { KeyRing } from "@/lib/crypto";

let ring: KeyRing | undefined;

/** Builds the token-encryption key ring from validated env. */
export function keyRing(): KeyRing {
  if (ring) return ring;
  const e = env();
  ring = {
    current: { version: e.TOKEN_ENC_KEY_VERSION, key: Buffer.from(e.TOKEN_ENC_KEY, "base64") },
    previous: e.TOKEN_ENC_KEY_PREVIOUS
      ? { version: e.TOKEN_ENC_KEY_VERSION - 1, key: Buffer.from(e.TOKEN_ENC_KEY_PREVIOUS, "base64") }
      : undefined,
  };
  return ring;
}
