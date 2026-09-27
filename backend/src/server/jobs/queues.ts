import type { PgBoss, Queue } from "pg-boss";

/** pg-boss queue names and payloads, shared by the web app (producers) and the worker. */
export const QUEUES = {
  mockBackfill: "mock-backfill",
  mockTick: "mock-tick",
  fitImport: "fit-import",
  maintenance: "maintenance",
} as const;

export type MockBackfillJob = { connectionId: string; days?: number };
export type FitImportJob = { jobId: string };

const QUEUE_OPTIONS: Record<(typeof QUEUES)[keyof typeof QUEUES], Omit<Queue, "name">> = {
  "mock-backfill": { policy: "stately", retryLimit: 2, retryBackoff: true },
  "mock-tick": { policy: "singleton", expireInSeconds: 120 },
  "fit-import": { retryLimit: 1, expireInSeconds: 30 * 60 },
  maintenance: { policy: "singleton", expireInSeconds: 15 * 60 },
};

/**
 * pg-boss v12 refuses to send to a queue that doesn't exist, so both the web
 * app and the worker create every queue (idempotently) on startup.
 */
export async function ensureQueues(boss: PgBoss) {
  for (const [name, options] of Object.entries(QUEUE_OPTIONS)) {
    if (!(await boss.getQueue(name))) await boss.createQueue(name, options);
  }
}
