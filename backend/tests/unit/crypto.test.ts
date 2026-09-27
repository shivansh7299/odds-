import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, safeEqual, sha256, type KeyRing } from "@/lib/crypto";

const key = (v: number) => ({ version: v, key: randomBytes(32) });

describe("token encryption", () => {
  const ring: KeyRing = { current: key(1) };

  it("round-trips a secret", () => {
    const ct = encryptSecret("refresh-token-123", ring);
    expect(decryptSecret(ct, ring)).toBe("refresh-token-123");
  });

  it("uses a fresh IV each time", () => {
    expect(encryptSecret("same", ring).equals(encryptSecret("same", ring))).toBe(false);
  });

  it("rejects tampered ciphertext", () => {
    const ct = encryptSecret("secret", ring);
    ct[ct.length - 1]! ^= 0xff;
    expect(() => decryptSecret(ct, ring)).toThrow();
  });

  it("decrypts rows written with the previous key after rotation", () => {
    const old = key(1);
    const ct = encryptSecret("legacy", { current: old });
    const rotated: KeyRing = { current: key(2), previous: old };
    expect(decryptSecret(ct, rotated)).toBe("legacy");
    expect(encryptSecret("new", rotated)[0]).toBe(2);
  });

  it("fails clearly when the key version is unknown", () => {
    const ct = encryptSecret("x", { current: key(7) });
    expect(() => decryptSecret(ct, ring)).toThrow(/No key for version 7/);
  });
});

describe("hash helpers", () => {
  it("sha256 is deterministic hex", () => {
    expect(sha256("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256("abc")).toBe(sha256("abc"));
  });

  it("safeEqual compares by value", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
