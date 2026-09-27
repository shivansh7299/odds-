import { execSync } from "node:child_process";
import { TEST_DATABASE_URL } from "./test-env";

/** Bring the test database schema up to date once per run. */
export default function setup() {
  if (!TEST_DATABASE_URL.includes("test")) {
    throw new Error("Refusing to run integration tests against a non-test database");
  }
  execSync("pnpm prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
