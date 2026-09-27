/**
 * Virtual Connect IQ watch: speaks exactly the protocol of connectiq/source/*.mc.
 * Use it to test pairing and ingest without the watch or the Connect IQ SDK.
 *
 *   pnpm simulate:watch                       # against http://localhost:3000
 *   pnpm simulate:watch -- --url https://x.ngrok-free.app --seconds 120
 *
 * It prints a pairing code; enter it on Sources → Connect IQ watch app.
 * The token is cached in .watch-token so later runs skip pairing.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const args = new Map<string, string>();
process.argv.slice(2).forEach((a, i, all) => a.startsWith("--") && args.set(a.slice(2), all[i + 1] ?? ""));
const BASE = (args.get("url") ?? "http://localhost:3000").replace(/\/$/, "");
const SECONDS = Number(args.get("seconds") ?? 60);
const TOKEN_FILE = ".watch-token";

const post = (path: string, body: unknown, token?: string) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pair(): Promise<string> {
  if (existsSync(TOKEN_FILE)) return readFileSync(TOKEN_FILE, "utf8").trim();
  const res = await post("/api/devices/pair/start", { name: "Virtual Forerunner", model: "fr265-sim" });
  if (res.status !== 201) throw new Error(`pair/start failed: ${res.status} ${await res.text()}`);
  const start = (await res.json()) as {
    deviceCode: string;
    userCode: string;
    verificationUrl: string;
    interval: number;
  };
  console.log(`\n  Pairing code:  ${start.userCode}\n  Enter it at:   ${start.verificationUrl}\n`);

  for (;;) {
    await sleep(start.interval * 1000);
    const p = await post("/api/devices/pair/poll", { deviceCode: start.deviceCode });
    if (p.status === 200) {
      const { token } = (await p.json()) as { token: string };
      writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
      console.log("  Paired. Token saved to .watch-token\n");
      return token;
    }
    if (p.status === 410) throw new Error("Pairing code expired");
    process.stdout.write(".");
  }
}

async function stream(token: string) {
  let steps = 3000 + Math.floor(Math.random() * 2000);
  const end = Date.now() + SECONDS * 1000;
  let bpm = 64;
  while (Date.now() < end) {
    const now = Math.floor(Date.now() / 1000);
    const hr: [number, number][] = [];
    const rr: { t: number; ms: number[] }[] = [];
    for (let s = 9; s >= 0; s--) {
      bpm = Math.max(50, Math.min(110, bpm + Math.round((Math.random() - 0.5) * 4)));
      hr.push([now - s, bpm]);
      const beat = 60_000 / bpm;
      const n = Math.max(1, Math.round(bpm / 60));
      rr.push({
        t: now - s,
        ms: Array.from({ length: n }, () => Math.round(beat + (Math.random() - 0.5) * 60)),
      });
    }
    steps += Math.floor(Math.random() * 25);
    const res = await post(
      "/api/ingest/connectiq",
      { model: "fr265-sim", live: { hr, rr }, steps: { t: now, total: steps } },
      token,
    );
    if (res.status === 401) {
      rmSync(TOKEN_FILE, { force: true });
      throw new Error("Token revoked on the dashboard; run again to re-pair");
    }
    console.log(
      `  ${new Date().toLocaleTimeString()}  ${res.status}  ${bpm} bpm  ${JSON.stringify(await res.json())}`,
    );
    await sleep(10_000);
  }
}

pair()
  .then(stream)
  .catch((err) => {
    console.error(`\n  ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
