import { describe, expect, it } from "vitest";
import { POST as approve } from "@/app/api/devices/pair/approve/route";
import { POST as poll } from "@/app/api/devices/pair/poll/route";
import { POST as start } from "@/app/api/devices/pair/start/route";
import { DELETE as revoke } from "@/app/api/devices/[id]/route";
import { GET as listDevices } from "@/app/api/devices/route";
import { POST as ingest } from "@/app/api/ingest/connectiq/route";
import { db } from "@/lib/db";
import { authedRequest, createUser } from "./helpers";

let ip = 0;
const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${++ip % 250}`, ...headers },
    body: JSON.stringify(body),
  });

async function pairWatch() {
  const { user, headers } = await createUser({ timezone: "America/New_York" });
  const started = await (
    await start(json("/api/devices/pair/start", { name: "My FR265", model: "fr265" }))
  ).json();
  expect(started.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  const pending = await poll(json("/api/devices/pair/poll", { deviceCode: started.deviceCode }));
  expect(pending.status).toBe(202);

  const approved = await approve(
    authedRequest("/api/devices/pair/approve", headers, {
      method: "POST",
      body: JSON.stringify({ userCode: started.userCode.toLowerCase().replace("-", " ") }),
    }),
  );
  expect(approved.status).toBe(201);

  await db.devicePairing.updateMany({ data: { lastPolledAt: null } }); // skip the 5 s poll interval
  const tokenRes = await poll(json("/api/devices/pair/poll", { deviceCode: started.deviceCode }));
  expect(tokenRes.status).toBe(200);
  const { token, deviceId } = await tokenRes.json();
  expect(token).toMatch(/^vs_/);
  return { user, headers, token, deviceId, deviceCode: started.deviceCode };
}

const now = () => Math.floor(Date.now() / 1000);

describe("Connect IQ pairing", () => {
  it("pairs a watch via user code and issues the token exactly once", async () => {
    const { user, deviceCode, deviceId } = await pairWatch();

    const again = await poll(json("/api/devices/pair/poll", { deviceCode }));
    expect(again.status).toBe(410);

    const device = await db.ingestDevice.findUniqueOrThrow({ where: { id: deviceId } });
    expect(device).toMatchObject({ userId: user.id, name: "My FR265", model: "fr265" });
    expect(device.tokenHash).toMatch(/^[0-9a-f]{64}$/); // only the hash is stored
  });

  it("rejects wrong, reused or expired user codes", async () => {
    const { headers } = await createUser();
    const res = await approve(
      authedRequest("/api/devices/pair/approve", headers, {
        method: "POST",
        body: JSON.stringify({ userCode: "AAAA-BBBB" }),
      }),
    );
    expect(res.status).toBe(404);

    const started = await (await start(json("/api/devices/pair/start", {}))).json();
    await db.devicePairing.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await approve(
      authedRequest("/api/devices/pair/approve", headers, {
        method: "POST",
        body: JSON.stringify({ userCode: started.userCode }),
      }),
    );
    expect(expired.status).toBe(404);
    expect((await poll(json("/api/devices/pair/poll", { deviceCode: started.deviceCode }))).status).toBe(410);
  });

  it("asks fast pollers to slow down", async () => {
    const started = await (await start(json("/api/devices/pair/start", {}))).json();
    await poll(json("/api/devices/pair/poll", { deviceCode: started.deviceCode }));
    const fast = await poll(json("/api/devices/pair/poll", { deviceCode: started.deviceCode }));
    expect(fast.status).toBe(429);
    expect((await fast.json()).status).toBe("slow_down");
  });

  it("requires sign-in to approve", async () => {
    const res = await approve(json("/api/devices/pair/approve", { userCode: "AAAA-BBBB" }));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/ingest/connectiq", () => {
  it("stores live HR, HRV from RR intervals, history, SpO₂ and step deltas", async () => {
    const { user, token } = await pairWatch();
    const t = now() - 600;
    const rr = Array.from({ length: 120 }, (_, i) => (i % 2 ? 1040 : 1000)); // RMSSD 40 ms
    const res = await ingest(
      json(
        "/api/ingest/connectiq",
        {
          model: "fr265",
          live: {
            hr: [
              [t, 61],
              [t + 1, 62],
            ],
            rr: [{ t, ms: rr }],
          },
          hr: [[t - 120, 58]],
          spo2: [[t - 60, 96]],
          steps: { t, total: 4200 },
        },
        { authorization: `Bearer ${token}` },
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rejected).toBe(0);

    const rows = await db.metricSample.findMany({ where: { userId: user.id } });
    const byType = (type: string) => rows.filter((r) => r.type === type);
    expect(byType("HEART_RATE")).toHaveLength(3);
    expect(byType("HRV_RMSSD").map((r) => r.value)).toEqual(expect.arrayContaining([40]));
    expect(byType("SPO2")[0]?.value).toBe(96);
    expect(byType("STEPS")[0]?.value).toBe(4200);

    // A later cumulative total only adds the difference.
    await ingest(
      json(
        "/api/ingest/connectiq",
        { steps: { t: t + 300, total: 4500 } },
        { authorization: `Bearer ${token}` },
      ),
    );
    const steps = await db.metricSample.findMany({ where: { userId: user.id, type: "STEPS" } });
    expect(steps.reduce((a, s) => a + s.value, 0)).toBe(4500);

    const device = await db.ingestDevice.findFirstOrThrow({ where: { userId: user.id } });
    expect(device.lastSeenAt).not.toBeNull();
  });

  it("rejects missing, bad and revoked tokens", async () => {
    expect((await ingest(json("/api/ingest/connectiq", {}))).status).toBe(401);
    expect(
      (await ingest(json("/api/ingest/connectiq", {}, { authorization: "Bearer vs_nope" }))).status,
    ).toBe(401);

    const { headers, token, deviceId } = await pairWatch();
    const res = await revoke(authedRequest(`/api/devices/${deviceId}`, headers, { method: "DELETE" }), {
      params: Promise.resolve({ id: deviceId }),
    });
    expect(res.status).toBe(204);
    const after = await ingest(
      json("/api/ingest/connectiq", { hr: [] }, { authorization: `Bearer ${token}` }),
    );
    expect(after.status).toBe(401);

    const list = await (await listDevices(authedRequest("/api/devices", headers))).json();
    expect(list.devices[0].revokedAt).not.toBeNull();
  });

  it("drops stale timestamps and validates ranges", async () => {
    const { token } = await pairWatch();
    const auth = { authorization: `Bearer ${token}` };
    const stale = await ingest(json("/api/ingest/connectiq", { hr: [[now() - 30 * 86_400, 60]] }, auth));
    expect(await stale.json()).toMatchObject({ accepted: 0, rejected: 1 });
    expect((await ingest(json("/api/ingest/connectiq", { hr: [[now(), 500]] }, auth))).status).toBe(400);
  });

  it("another user can't revoke your device", async () => {
    const { deviceId } = await pairWatch();
    const other = await createUser();
    const res = await revoke(authedRequest(`/api/devices/${deviceId}`, other.headers, { method: "DELETE" }), {
      params: Promise.resolve({ id: deviceId }),
    });
    expect(res.status).toBe(404);
  });
});
