import os from "node:os";
import path from "node:path";

/** Environment for integration tests: a dedicated database, never the dev one. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://vitalsync:vitalsync@localhost:5432/vitalsync_test?schema=public";

export function applyTestEnv() {
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: TEST_DATABASE_URL,
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-123",
    BETTER_AUTH_URL: "http://localhost:3000",
    TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString("base64"),
    ENABLE_MOCK_SOURCE: "true",
    UPLOAD_DIR: path.join(os.tmpdir(), "vitalsync-test-uploads"),
    VITALSYNC_CORS_ORIGINS: "http://localhost:8000,https://friends.example",
  });
}
