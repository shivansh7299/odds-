import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/ingest/ble/route";
import { db } from "@/lib/db";
import { authedRequest, createUser } from "./helpers";

const post = (headers: Headers, body: unknown) =>
  POST(
    authedRequest("/api/ingest/ble", headers, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );

describe("POST /api/ingest/ble", () => {
  it("requires a session", async () => {
    const res = await POST(
      new Request("http://localhost:3000/api/ingest/ble", { method: "POST", body: "{}" }),
    );
    expect(res.status).toBe(401);
  });

  it("creates the BLE connection on first data and stores 1 s samples", async () => {
    const { user, headers } = await createUser();
    const now = Date.now();
    const samples = Array.from({ length: 10 }, (_, i) => ({ ts: now - (10 - i) * 1000, bpm: 70 + i }));
    const res = await post(headers, { samples });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: 10, rejected: 0 });

    const conn = await db.sourceConnection.findUniqueOrThrow({
      where: { userId_source: { userId: user.id, source: "GARMIN_BLE" } },
    });
    const rows = await db.metricSample.findMany({ where: { connectionId: conn.id } });
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.resolutionSec === 1 && r.ts.getMilliseconds() === 0)).toBe(true);
  });

  it("rejects stale or future timestamps, and out-of-range values", async () => {
    const { headers } = await createUser();
    const res = await post(headers, {
      samples: [
        { ts: Date.now() - 2 * 86_400_000, bpm: 60 },
        { ts: Date.now() + 10 * 60_000, bpm: 60 },
        { ts: Date.now(), bpm: 61 },
      ],
    });
    expect(await res.json()).toEqual({ accepted: 1, rejected: 2 });
    expect((await post(headers, { samples: [{ ts: Date.now(), bpm: 400 }] })).status).toBe(400);
    expect((await post(headers, "not json")).status).toBe(400);
  });

  it("rejects oversized bodies", async () => {
    const { headers } = await createUser();
    const res = await post(headers, "x".repeat(70 * 1024));
    expect(res.status).toBe(413);
  });

  it("refuses to write into a paused source", async () => {
    const { user, headers } = await createUser();
    await db.sourceConnection.create({ data: { userId: user.id, source: "GARMIN_BLE", status: "PAUSED" } });
    expect((await post(headers, { samples: [{ ts: Date.now(), bpm: 60 }] })).status).toBe(409);
  });
});
