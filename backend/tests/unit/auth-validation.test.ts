import { describe, expect, it } from "vitest";
import { safeRedirectPath, signInSchema, signUpSchema } from "@/lib/validation/auth";
import { isValidTimezone, normalizeTimezone } from "@/lib/timezone";

describe("safeRedirectPath", () => {
  it.each([
    ["/dashboard?range=7d", "/dashboard?range=7d"],
    ["/sleep", "/sleep"],
    ["//evil.com", "/dashboard"],
    ["/\\evil.com", "/dashboard"],
    ["https://evil.com", "/dashboard"],
    ["javascript:alert(1)", "/dashboard"],
    ["/ok\r\nSet-Cookie:x", "/dashboard"],
    [null, "/dashboard"],
  ])("%s → %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });
});

describe("signUpSchema", () => {
  const base = {
    name: " Ada ",
    email: " ADA@Example.com ",
    password: "long-enough",
    confirmPassword: "long-enough",
  };

  it("normalizes name and email", () => {
    expect(signUpSchema.parse(base)).toMatchObject({ name: "Ada", email: "ada@example.com" });
  });

  it("rejects short passwords", () => {
    const r = signUpSchema.safeParse({ ...base, password: "short", confirmPassword: "short" });
    expect(r.success).toBe(false);
  });

  it("rejects mismatched confirmation on the confirm field", () => {
    const r = signUpSchema.safeParse({ ...base, confirmPassword: "different" });
    expect(r.error?.issues[0]?.path).toEqual(["confirmPassword"]);
  });
});

describe("signInSchema", () => {
  it("requires a password", () => {
    expect(signInSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });
});

describe("timezone", () => {
  it("accepts IANA zones and rejects junk", () => {
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("Mars/Base")).toBe(false);
    expect(normalizeTimezone(42)).toBe("UTC");
  });
});
