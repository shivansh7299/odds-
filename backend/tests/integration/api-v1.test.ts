import { describe, expect, it } from "vitest";
import { GET as exportGet, OPTIONS as exportOptions } from "@/app/api/v1/export/route";
import { GET as liveGet } from "@/app/api/v1/live/route";
import { GET as meGet } from "@/app/api/v1/me/route";
import { GET as listTokens, POST as createToken } from "@/app/api/tokens/route";
import { DELETE as deleteToken } from "@/app/api/tokens/[id]/route";
import { db } from "@/lib/db";
import { ingestBatch } from "@/server/ingest/ingest";
import { generateRange, profileFor } from "@/server/sources/mock/generator";
import { authedRequest, createUser } from "./helpers";

const api = (path: string, token?: string, origin?: string, method = "GET") =>
  new Request(`http://localhost:3000${path}`, {
    method,
    headers: { ...(token && { authorization: `Bearer ${token}` }), ...(origin && { origin }) },
  });

async function userWithKey() {
  const u = await createUser({ timezone: "America/New_York" });
  const res = await createToken(
    authedRequest("/api/tokens", u.headers, { method: "POST", body: JSON.stringify({ name: "Pulse Check" }) }),
  );
  expect(res.status).toBe(201);
  const { token } = await res.json();
  return { ...u, token: token.token as string, tokenId: token.id as string };
}

describe("API keys", () => {
  it("are shown once, listed by prefix only, and revocable", async () => {
    const { headers, token, tokenId } = await userWithKey();
    expect(token).toMatch(/^vsk_/);
    const list = await (await listTokens(authedRequest("/api/tokens", headers))).json();
    expect(list.tokens).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(token);

    expect((await meGet(api("/api/v1/me", token))).status).toBe(200);
    const del = await deleteToken(authedRequest(`/api/tokens/${tokenId}`, headers, { method: "DELETE" }), {
      params: Promise.resolve({ id: tokenId }),
    });
    expect(del.status).toBe(204);
    expect((await meGet(api("/api/v1/me", token))).status).toBe(401);
  });

  it("reject missing or wrong keys, and session cookies alone", async () => {
    const { headers } = await userWithKey();
    expect((await meGet(api("/api/v1/me"))).status).toBe(401);
    expect((await meGet(api("/api/v1/me", "vsk_wrong"))).status).toBe(401);
    expect((await meGet(authedRequest("/api/v1/me", headers))).status).toBe(401);
  });
});

describe("CORS", () => {
  it("allows only configured origins", async () => {
    const { token } = await userWithKey();
    const ok = await meGet(api("/api/v1/me", token, "https://friends.example"));
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://friends.example");
    const evil = await meGet(api("/api/v1/me", token, "https://evil.example"));
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    // errors carry CORS headers too, so the site can show a useful message
    const unauth = await meGet(api("/api/v1/me", undefined, "https://friends.example"));
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get("access-control-allow-origin")).toBe("https://friends.example");
  });

  it("answers preflight with the allowed headers", async () => {
    const res = await exportOptions(api("/api/v1/export", undefined, "http://localhost:8000", "OPTIONS"));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toContain("Authorization");
    expect(res.headers.get("access-control-allow-headers")).toContain("ngrok-skip-browser-warning");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });
});

describe("GET /api/v1/export and /live", () => {
  it("exports daily values and local-time heart-rate samples in a generic tracker shape", async () => {
    const { user, token } = await userWithKey();
    const conn = await db.sourceConnection.create({ data: { userId: user.id, source: "MOCK" } });
    const now = new Date();
    await ingestBatch(
      { id: conn.id, userId: user.id, source: "MOCK", timezone: "America/New_York" },
      generateRange(profileFor(user.id), "America/New_York", new Date(now.getTime() - 5 * 86_400_000), now),
      { publish: false },
    );

    const res = await exportGet(api("/api/v1/export?days=7&hrDays=2", token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("VitalSync");
    expect(body.daily.length).toBeGreaterThanOrEqual(4);
    const day = body.daily.find((d: Record<string, unknown>) => d.restingHeartRate != null);
    expect(day).toMatchObject({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(Object.keys(day)).toEqual(expect.arrayContaining(["restingHeartRate", "hrvRmssd", "steps", "sleepHours"]));
    expect(body.heartRate.length).toBeGreaterThan(100);
    expect(body.heartRate[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/); // local time with offset

    const live = await (await liveGet(api("/api/v1/live", token))).json();
    expect(live.heartRate).toMatchObject({ bpm: expect.any(Number), source: "MOCK" });
    expect(live.heartRate.ageSec).toBeLessThan(120);

    expect((await exportGet(api("/api/v1/export?days=9999", token))).status).toBe(400);
  });

  it("returns null live heart rate when nothing recent", async () => {
    const { token } = await userWithKey();
    expect(await (await liveGet(api("/api/v1/live", token))).json()).toEqual({ heartRate: null });
  });
});
