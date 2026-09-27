import { existsSync } from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/import/fit/route";
import { db } from "@/lib/db";
import { runFitImport } from "@/server/sources/fit/service";
import { activityFit, monitoringFit, sleepFit } from "../fixtures/fit";
import { authedRequest, createUser } from "./helpers";

function upload(headers: Headers, bytes: Uint8Array, name: string) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name));
  return POST(authedRequest("/api/import/fit", headers, { method: "POST", body: form }));
}

describe("FIT import", () => {
  it("imports a Garmin-style export zip end to end, once", async () => {
    const { user, headers } = await createUser({ timezone: "America/New_York" });
    const zip = zipSync({
      "Activity/run.fit": activityFit(),
      "nested.zip": zipSync({ "Monitor/day.fit": monitoringFit(), "Sleep/night.fit": sleepFit() }),
      "notes.txt": new TextEncoder().encode("ignored"),
    });

    const res = await upload(headers, zip, "garmin-export.zip");
    expect(res.status).toBe(202);
    const { job } = await res.json();
    expect(existsSync(path.join(process.env.UPLOAD_DIR!, `${job.id}.bin`))).toBe(true);

    await runFitImport({ jobId: job.id });

    const done = await db.importJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe("SUCCEEDED");
    expect(done.error).toBeNull();
    expect(done.recordsUpserted).toBeGreaterThan(30);
    expect(existsSync(path.join(process.env.UPLOAD_DIR!, `${job.id}.bin`))).toBe(false); // temp file removed

    expect(await db.workout.count({ where: { userId: user.id } })).toBe(1);
    expect(await db.sleepSession.count({ where: { userId: user.id } })).toBe(1);
    expect(await db.metricSample.count({ where: { userId: user.id, type: "STEPS" } })).toBe(2);
    expect(await db.dailySummary.count({ where: { userId: user.id } })).toBeGreaterThan(0);

    // Same bytes again: no new job, no new rows.
    const again = await upload(headers, zip, "renamed.zip");
    expect(again.status).toBe(200);
    expect((await again.json()).duplicate).toBe(true);

    const list = await (await GET(authedRequest("/api/import/fit", headers))).json();
    expect(list.imports).toHaveLength(1);
  });

  it("marks unreadable uploads as failed and allows a retry", async () => {
    const { headers } = await createUser();
    const junk = new TextEncoder().encode("definitely not a fit file");
    const { job } = await (await upload(headers, junk, "broken.fit")).json();
    await runFitImport({ jobId: job.id });
    const failed = await db.importJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.error).toMatch(/None of the 1 files could be read/);

    const retry = await upload(headers, junk, "broken.fit");
    expect(retry.status).toBe(202); // failed jobs can be re-queued
  });

  it("rejects wrong file types and missing files", async () => {
    const { headers } = await createUser();
    expect((await upload(headers, new Uint8Array([1, 2]), "photo.jpg")).status).toBe(415);
    const empty = await POST(
      authedRequest("/api/import/fit", headers, { method: "POST", body: new FormData() }),
    );
    expect(empty.status).toBe(400);
  });

  it("keeps each user's imports separate", async () => {
    const a = await createUser();
    const b = await createUser();
    const fit = activityFit();
    await upload(a.headers, fit, "run.fit");
    const res = await upload(b.headers, fit, "run.fit");
    expect(res.status).toBe(202); // same bytes, different user: not a duplicate
    const list = await (await GET(authedRequest("/api/import/fit", b.headers))).json();
    expect(list.imports).toHaveLength(1);
  });
});
