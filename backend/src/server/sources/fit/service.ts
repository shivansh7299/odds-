import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { METRIC_TYPES } from "@/lib/metrics/definitions";
import { getBoss } from "@/server/jobs/boss";
import { QUEUES, type FitImportJob } from "@/server/jobs/queues";
import { ingestBatch, withSyncRun } from "@/server/ingest/ingest";
import { realtimeBus } from "@/server/realtime/pg-bus";
import { ensurePushConnection } from "@/server/sources/connections";
import { decodeFit } from "@/server/sources/fit/decode";
import { extractFitFiles } from "@/server/sources/fit/unzip";

export const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
const MAX_FIT_BYTES = 25 * 1024 * 1024;

const uploadPath = (jobId: string) => path.resolve(env().UPLOAD_DIR, `${jobId}.bin`);

const jobView = {
  id: true,
  filename: true,
  sizeBytes: true,
  status: true,
  recordsUpserted: true,
  error: true,
  createdAt: true,
  finishedAt: true,
} as const;

export async function listImports(userId: string) {
  return db.importJob.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: jobView,
  });
}

/** Stores an upload and queues it. Re-uploading the same bytes returns the existing job. */
export async function queueImport(user: { id: string; timezone: string }, file: File) {
  const filename = file.name.slice(0, 200) || "upload";
  if (!/\.(fit|zip)$/i.test(filename)) {
    throw new AppError(415, "unsupported_file", "Upload .fit files or a .zip (e.g. a Garmin Connect export)");
  }
  const limit = /\.zip$/i.test(filename) ? MAX_UPLOAD_BYTES : MAX_FIT_BYTES;
  if (file.size > limit)
    throw new AppError(413, "payload_too_large", `File is larger than ${limit / 1024 / 1024} MB`);
  if (file.size === 0) throw new AppError(400, "empty_file", "File is empty");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const existing = await db.importJob.findUnique({ where: { userId_sha256: { userId: user.id, sha256 } } });
  if (existing && existing.status !== "FAILED") {
    return {
      job: await db.importJob.findUniqueOrThrow({ where: { id: existing.id }, select: jobView }),
      duplicate: true,
    };
  }

  const target = await ensurePushConnection(user, "GARMIN_FIT");
  const job = existing
    ? await db.importJob.update({
        where: { id: existing.id },
        data: { status: "QUEUED", error: null, recordsUpserted: 0, finishedAt: null, filename },
        select: jobView,
      })
    : await db.importJob.create({
        data: { userId: user.id, connectionId: target.id, filename, sizeBytes: file.size, sha256 },
        select: jobView,
      });

  await mkdir(path.resolve(env().UPLOAD_DIR), { recursive: true });
  await writeFile(uploadPath(job.id), bytes);
  const boss = await getBoss();
  await boss.send(QUEUES.fitImport, { jobId: job.id } satisfies FitImportJob, {
    retryLimit: 1,
    singletonKey: job.id,
  });
  await realtimeBus.publish(user.id, {
    kind: "sync",
    source: "GARMIN_FIT",
    status: "QUEUED",
    message: `Queued ${filename}`,
  });
  return { job, duplicate: false };
}

/** Worker: decode every FIT file in the upload and ingest it, reporting progress. */
export async function runFitImport({ jobId }: FitImportJob) {
  const job = await db.importJob.findUnique({
    where: { id: jobId },
    include: { user: { select: { timezone: true } }, connection: { select: { status: true } } },
  });
  if (!job || job.status === "SUCCEEDED") return;
  const target = {
    id: job.connectionId,
    userId: job.userId,
    source: "GARMIN_FIT" as const,
    timezone: job.user.timezone,
  };
  const publish = (status: "RUNNING" | "SUCCEEDED" | "FAILED", message: string, progress?: number) =>
    realtimeBus.publish(job.userId, {
      kind: "sync",
      source: "GARMIN_FIT",
      status,
      message: message.slice(0, 200),
      progress,
    });

  await db.importJob.update({ where: { id: jobId }, data: { status: "RUNNING" } });
  try {
    const result = await withSyncRun(job.connectionId, "IMPORT", async () => {
      const bytes = new Uint8Array(await readFile(uploadPath(jobId)));
      const { files, skipped } = extractFitFiles(bytes, job.filename);
      const problems = [...skipped];
      let records = 0;
      let readable = 0;
      let lastPublish = 0;

      for (const [i, f] of files.entries()) {
        try {
          const decoded = decodeFit(f.bytes, f.name);
          readable++;
          const r = await ingestBatch(target, decoded, { publish: false });
          records += r.samples + r.sleepSessions + r.workouts;
        } catch (err) {
          problems.push(`${f.name}: ${err instanceof Error ? err.message : "unreadable"}`);
        }
        if (Date.now() - lastPublish > 500 || i === files.length - 1) {
          lastPublish = Date.now();
          await publish(
            "RUNNING",
            `Imported ${i + 1} of ${files.length} files`,
            (i + 1) / Math.max(1, files.length),
          );
          await db.importJob.update({ where: { id: jobId }, data: { recordsUpserted: records } });
        }
      }
      if (files.length === 0) throw new Error("No .fit files found in the upload");
      if (readable === 0)
        throw new Error(`None of the ${files.length} files could be read: ${problems[0] ?? ""}`);
      return { records, files: files.length, problems };
    });

    const note = result.problems.length
      ? `${result.problems.length} of ${result.files} files skipped (e.g. ${result.problems[0]})`.slice(
          0,
          500,
        )
      : null;
    await db.importJob.update({
      where: { id: jobId },
      data: { status: "SUCCEEDED", recordsUpserted: result.records, error: note, finishedAt: new Date() },
    });
    await publish("SUCCEEDED", `Imported ${result.records} records from ${result.files} files`);
    for (const kind of ["sleep", "workouts"] as const)
      await realtimeBus.publish(job.userId, { kind, source: "GARMIN_FIT" });
    await realtimeBus.publish(job.userId, {
      kind: "metrics",
      source: "GARMIN_FIT",
      types: METRIC_TYPES,
      from: new Date(0).toISOString(),
      to: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";
    await db.importJob.update({
      where: { id: jobId },
      data: { status: "FAILED", error: message.slice(0, 500), finishedAt: new Date() },
    });
    await publish("FAILED", message);
    // Not rethrown: a bad file won't get better on retry.
  } finally {
    await rm(uploadPath(jobId), { force: true });
  }
}
