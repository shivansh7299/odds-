import "server-only";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Hourly housekeeping (worker cron):
 *  - pairing codes: unused ones after 1 day, collected ones after 30 days
 *  - expired OAuth state (reserved for pull sources)
 *  - imports stuck RUNNING for > 1 h (worker crashed mid-import) → FAILED
 *  - upload files older than 1 day with no active job
 */
export async function runMaintenance(now = new Date()) {
  const pairings = await db.devicePairing.deleteMany({
    where: {
      OR: [
        { status: { not: "CONSUMED" }, expiresAt: { lt: new Date(now.getTime() - DAY) } },
        { status: "CONSUMED", createdAt: { lt: new Date(now.getTime() - 30 * DAY) } },
      ],
    },
  });
  const oauth = await db.oAuthState.deleteMany({ where: { expiresAt: { lt: now } } });
  const stuck = await db.importJob.updateMany({
    where: { status: "RUNNING", createdAt: { lt: new Date(now.getTime() - HOUR) } },
    data: { status: "FAILED", error: "Import was interrupted. Upload the file again.", finishedAt: now },
  });

  let files = 0;
  const dir = path.resolve(env().UPLOAD_DIR);
  const names = await readdir(dir).catch(() => [] as string[]);
  const active = new Set(
    (
      await db.importJob.findMany({ where: { status: { in: ["QUEUED", "RUNNING"] } }, select: { id: true } })
    ).map((j) => `${j.id}.bin`),
  );
  for (const name of names) {
    if (active.has(name)) continue;
    const full = path.join(dir, name);
    const info = await stat(full).catch(() => null);
    if (info && now.getTime() - info.mtimeMs > DAY) {
      await rm(full, { force: true });
      files++;
    }
  }
  return { pairings: pairings.count, oauthStates: oauth.count, stuckImports: stuck.count, files };
}
