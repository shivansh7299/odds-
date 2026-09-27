import "server-only";
import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";
import { ensureQueues } from "@/server/jobs/queues";

const globalForBoss = globalThis as unknown as { boss?: Promise<PgBoss> };

/**
 * Producer-side pg-boss for the web app: sends jobs only. Maintenance and cron
 * scheduling run in the worker process.
 */
export function getBoss(): Promise<PgBoss> {
  globalForBoss.boss ??= (async () => {
    const boss = new PgBoss({ connectionString: env().DATABASE_URL, supervise: false, schedule: false });
    boss.on("error", (err) => console.error("[jobs] pg-boss error", err));
    await boss.start();
    await ensureQueues(boss);
    return boss;
  })().catch((err) => {
    globalForBoss.boss = undefined; // retry on next call
    throw err;
  });
  return globalForBoss.boss;
}
