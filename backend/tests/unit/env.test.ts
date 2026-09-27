import { describe, expect, it } from "vitest";
import { serverEnvSchema } from "@/lib/env";

const valid = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  TOKEN_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
};

describe("serverEnvSchema", () => {
  it("accepts a minimal valid env and applies defaults", () => {
    const env = serverEnvSchema.parse(valid);
    expect(env.TOKEN_ENC_KEY_VERSION).toBe(1);
    expect(env.ENABLE_MOCK_SOURCE).toBe(false);
  });

  it("parses boolean strings", () => {
    expect(serverEnvSchema.parse({ ...valid, ENABLE_MOCK_SOURCE: "true" }).ENABLE_MOCK_SOURCE).toBe(true);
  });

  it("rejects an encryption key that is not 32 bytes", () => {
    const r = serverEnvSchema.safeParse({ ...valid, TOKEN_ENC_KEY: Buffer.alloc(16).toString("base64") });
    expect(r.success).toBe(false);
  });

  it("rejects a non-Postgres database URL", () => {
    expect(serverEnvSchema.safeParse({ ...valid, DATABASE_URL: "mysql://x@y/z" }).success).toBe(false);
  });
});
