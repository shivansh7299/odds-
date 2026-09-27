import "server-only";
import { z } from "zod";

const booleanString = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

/** 32 raw bytes, base64-encoded. Generate with: openssl rand -base64 32 */
const aesKey = z
  .string()
  .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64-encoded");

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url().startsWith("postgres", "must be a PostgreSQL connection string"),

  BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
  BETTER_AUTH_URL: z.url(),
  /** Extra origins allowed to sign in, comma-separated (e.g. your ngrok domain). */
  BETTER_AUTH_TRUSTED_ORIGINS: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((o) => o.trim().replace(/\/$/, ""))
        .filter(Boolean),
    )
    .pipe(z.array(z.url())),

  /** Current key for encrypting third-party tokens at rest. */
  TOKEN_ENC_KEY: aesKey,
  TOKEN_ENC_KEY_VERSION: z.coerce.number().int().positive().default(1),
  /** Optional previous key, kept only to decrypt rows written before a rotation. */
  TOKEN_ENC_KEY_PREVIOUS: aesKey.optional(),

  ENABLE_MOCK_SOURCE: booleanString.default(false),

  /** Sites allowed to call the read-only /api/v1 API from a browser (comma-separated origins). */
  VITALSYNC_CORS_ORIGINS: z
    .string()
    .default("http://localhost:8000,http://127.0.0.1:8000")
    .transform((v) =>
      v
        .split(",")
        .map((o) => o.trim().replace(/\/$/, ""))
        .filter(Boolean),
    )
    .pipe(z.array(z.url())),

  /** Temporary storage for uploaded FIT/zip files until the worker imports them. */
  UPLOAD_DIR: z.string().min(1).default(".uploads"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

/**
 * Validated server environment. Parsed lazily on first access so `next build`
 * can import server modules without every secret present.
 */
export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  • ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment variables:\n${issues}\nSee .env.example.`);
  }
  cached = parsed.data;
  return cached;
}
