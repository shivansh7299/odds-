import "dotenv/config";
import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { ensureQueues, QUEUES, type FitImportJob, type MockBackfillJob } from "@/server/jobs/queues";
import { runMaintenance } from "@/server/maintenance/cleanup";
import { runFitImport } from "@/server/sources/fit/service";
import { runMockBackfill, runMockTick } from "@/server/sources/mock/service";

/**
 * Background worker: consumes pg-boss jobs and runs scheduled tasks.
 * Run with `pnpm worker` (or `pnpm dev:all` alongside the web app).
 */
async function timed<T>(name: string, fields: Record<string, unknown>, fn: () => Promise<T>) {
  const started = Date.now();
  try {
    const result = await fn();
    log.info(`${name} done`, { ...fields, ms: Date.now() - started });
    return result;
  } catch (err) {
    log.error(`${name} failed`, { ...fields, ms: Date.now() - started, err });
    throw err; // let pg-boss retry per queue policy
  }
}

async function main() {
  const boss = new PgBoss({ connectionString: env().DATABASE_URL });
  boss.on("error", (err) => log.error("pg-boss error", { err }));
  await boss.start();
  await ensureQueues(boss);

  await boss.work<MockBackfillJob>(QUEUES.mockBackfill, async ([job]) => {
    if (job)
      await timed("mock backfill", { connectionId: job.data.connectionId }, () => runMockBackfill(job.data));
  });

  await boss.work<FitImportJob>(QUEUES.fitImport, async ([job]) => {
    if (job) await timed("fit import", { jobId: job.data.jobId }, () => runFitImport(job.data));
  });

  await boss.work(QUEUES.maintenance, async () => {
    const r = await timed("maintenance", {}, () => runMaintenance());
    log.info("maintenance summary", r);
  });
  await boss.schedule(QUEUES.maintenance, "17 * * * *"); // hourly

  if (env().ENABLE_MOCK_SOURCE) {
    await boss.work(QUEUES.mockTick, async () => {
      await runMockTick();
    });
    await boss.schedule(QUEUES.mockTick, "* * * * *");
  } else {
    await boss.unschedule(QUEUES.mockTick).catch(() => {});
  }

  log.info("worker ready", { mock: env().ENABLE_MOCK_SOURCE });

  const shutdown = async (signal: string) => {
    log.info("worker draining", { signal });
    await boss.stop({ graceful: true, timeout: 20_000 });
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error("worker fatal", { err });
  process.exit(1);
});
