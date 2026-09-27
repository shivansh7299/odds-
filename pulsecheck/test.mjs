import { PPGProcessor } from "./ppg-core.js";
import { Simulator } from "./ppg-inputs.js";
function run({ hr = 72, artifact = "none", secs = 40, useMotion = true, seed = 3 }) {
  const sim = new Simulator({ hr, seed }), p = new PPGProcessor();
  const out = []; let next = 0;
  for (let i = 0; i < secs * 30; i++) {
    if (sim.t > 12) sim.artifact = artifact;          // clean for 12 s, then artifact
    const { ppg, motion } = sim.step();
    p.pushPPG(ppg.t, ppg.r, ppg); if (useMotion) p.pushMotion(motion.t, motion.mag);
    if (sim.t >= next) { next += 0.5; const r = p.compute(sim.t); out.push(r); }
  }
  return { out, p };
}
const stat = (arr) => { const c = {}; arr.forEach((s) => (c[s] = (c[s] || 0) + 1)); return Object.entries(c).map(([k, v]) => `${k}:${Math.round((100 * v) / arr.length)}%`).join(" "); };
console.log("== clean signal, HR accuracy (after warm-up)");
for (const hr of [45, 60, 72, 90, 120, 150, 180]) {
  const { out, p } = run({ hr, secs: 40 });
  const v = out.filter((r) => r.t > 12 && r.hr && !r.hrStale);
  const err = v.map((r) => Math.abs(r.hr - hr));
  console.log(`HR ${hr}: mean |err| ${(err.reduce((a, b) => a + b, 0) / err.length).toFixed(2)} bpm, max ${Math.max(...err).toFixed(2)}, quality ${stat(out.filter((r) => r.t > 12).map((r) => r.status))}, score ${(out.at(-1).score).toFixed(2)}, rmssd ${out.at(-1).rmssd?.toFixed(0)}ms`);
}
console.log("== artifacts (windows fully inside artifact period)");
for (const a of ["motion", "weak", "press", "nofinger"]) for (const useMotion of [true, false]) {
  if (a !== "motion" && !useMotion) continue;
  const { out, p } = run({ artifact: a, secs: 40, useMotion });
  const inA = out.filter((r) => r.t > 22);
  console.log(`${a}${useMotion ? "" : " (no accelerometer)"}: ${stat(inA.map((r) => r.status))}; reasons: ${inA.at(-1).reasons[0]}; comps ${JSON.stringify(Object.fromEntries(Object.entries(inA.at(-1).components).map(([k, v]) => [k, v == null ? null : +v.toFixed(2)])))}`);
}
const { p } = run({ artifact: "motion", secs: 30 });
console.log(JSON.stringify(p.summary(), null, 1));
