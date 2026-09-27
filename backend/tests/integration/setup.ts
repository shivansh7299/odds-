import { afterAll, beforeEach } from "vitest";
import { applyTestEnv } from "./test-env";

applyTestEnv();

const { db } = await import("@/lib/db");

/** Wipe all app tables between tests (keeps the migrations table). */
beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await db.$executeRawUnsafe(
      `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`,
    );
  }
});

afterAll(async () => {
  await db.$disconnect();
});
