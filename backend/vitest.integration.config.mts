import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/setup.ts", "tests/integration/setup.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    fileParallelism: false, // tests share one database
    testTimeout: 20_000,
  },
});
