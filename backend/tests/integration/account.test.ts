import { mkdir, utimes, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PATCH as patchAccount } from "@/app/api/account/route";
import { GET as exportData } from "@/app/api/account/export/route";
import { DELETE as deleteSource } from "@/app/api/sources/[source]/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ingestBatch } from "@/server/ingest/ingest";
import { runMaintenance } from "@/server/maintenance/cleanup";
import { authedRequest, createUser } from "./helpers";

async function userWithData(timezone = "UTC") {
  const u = await createUser({ timezone });
  const conn = await db.sourceConnection.create({ data: { userId: u.user.id, source: "GARMIN_FIT" } });
  await ingestBatch(
    { id: conn.id, userId: u.user.id, source: "GARMIN_FIT", timezone },
    {
      samples: [
        { type: "STEPS", ts: new Date("2026-03-10T02:00:00Z"), value: 100, resolutionSec: 60 },
        { type: "HEART_RATE", ts: new Date("2026-03-10T02:00:00Z"), value: 60, resolutionSec: 60 },
      ],
    },
    { publish: false },
  );
  return { ...u, conn };
}

describe("account", () => {
  it("rebuilds daily summaries when the timezone changes", async () => {
    const { user, headers } = await userWithData("UTC");
    const dates = async () =>
      (await db.dailySummary.findMany({ where: { userId: user.id } })).map((d) =>
        d.date.toISOString().slice(0, 10),
      );
    expect(await dates()).toEqual(["2026-03-10"]);

    const res = await patchAccount(
      authedRequest("/api/account", headers, {
        method: "PATCH",
        body: JSON.stringify({ timezone: "America/Los_Angeles" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await dates()).toEqual(["2026-03-09"]); // 02:00Z is the evening before in LA

    const bad = await patchAccount(
      authedRequest("/api/account", headers, {
        method: "PATCH",
        body: JSON.stringify({ timezone: "Mars/Olympus" }),
      }),
    );
    expect(bad.status).toBe(400);
  });

  it("exports all of the user's data without secrets", async () => {
    const { headers } = await userWithData();
    const res = await exportData(authedRequest("/api/account/export", headers));
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="vitalsync-export-/);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.samples).toHaveLength(2);
    expect(body.dailySummaries).toHaveLength(1);
    expect(text).not.toMatch(/password|tokenHash|accessTokenEnc/);
  });

  it("deletes one source and all of its data", async () => {
    const { user, headers } = await userWithData();
    const res = await deleteSource(authedRequest("/api/sources/fit", headers, { method: "DELETE" }), {
      params: Promise.resolve({ source: "fit" }),
    });
    expect(res.status).toBe(204);
    expect(await db.metricSample.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.dailySummary.count({ where: { userId: user.id } })).toBe(0);
  });

  it("deletes the account and cascades everything (password required)", async () => {
    const { user, headers } = await userWithData();
    const wrong = await auth.api.deleteUser({ headers, body: { password: "nope-nope" }, asResponse: true });
    expect(wrong.ok).toBe(false);
    const ok = await auth.api.deleteUser({
      headers,
      body: { password: "correct-horse-battery" },
      asResponse: true,
    });
    expect(ok.ok).toBe(true);
    expect(await db.user.count({ where: { id: user.id } })).toBe(0);
    expect(await db.metricSample.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.sourceConnection.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("maintenance", () => {
  it("cleans expired pairings, stuck imports and stale upload files", async () => {
    const { user, conn } = await userWithData();
    const old = new Date(Date.now() - 3 * 86_400_000);
    await db.devicePairing.create({
      data: { deviceCodeHash: "a".repeat(64), userCodeHash: "b".repeat(64), deviceName: "x", expiresAt: old },
    });
    const fresh = await db.devicePairing.create({
      data: {
        deviceCodeHash: "c".repeat(64),
        userCodeHash: "d".repeat(64),
        deviceName: "y",
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    const stuck = await db.importJob.create({
      data: {
        userId: user.id,
        connectionId: conn.id,
        filename: "a.fit",
        sizeBytes: 1,
        sha256: "e".repeat(64),
        status: "RUNNING",
        createdAt: old,
      },
    });

    const dir = path.resolve(process.env.UPLOAD_DIR!);
    await mkdir(dir, { recursive: true });
    const stale = path.join(dir, "orphan.bin");
    await writeFile(stale, "x");
    await utimes(stale, old, old);

    const r = await runMaintenance();
    expect(r).toMatchObject({ pairings: 1, stuckImports: 1 });
    expect(await db.devicePairing.findUnique({ where: { id: fresh.id } })).not.toBeNull();
    expect((await db.importJob.findUniqueOrThrow({ where: { id: stuck.id } })).status).toBe("FAILED");
    expect(existsSync(stale)).toBe(false);
  });
});
