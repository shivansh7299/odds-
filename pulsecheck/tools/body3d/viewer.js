/*
 * body3d viewer: Plethscape's BodyParts3D anatomy (createAnatomy) in a plain canvas, driven by
 * whatever heart rate and breathing the page feeds it. Bundled by tools/build-body3d.mjs.
 *
 *   const body = mountBody(hostElement, { state: () => ({ hr, breath, brain, running }), onPick, onStatus });
 *   body.focus("heart" | "brain" | "eyes" | "jaw" | "lungs" | "finger" | "wrist" | "body");
 *   body.setWearables(true); body.setLayer("skeleton", false); body.dispose();
 *   state().muse = { TP9, AF7, AF8, TP10 } (0..1 activity) lights the Muse headband's electrodes.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createAnatomy } from "./src/bodyparts";
import { createSensorAuras } from "./src/sensorAuras";
import { WEARABLE_SITES } from "./src/devices";

const HOME = { pos: [0.12, 1.87, 6.45], target: [0, 1.82, 0] };
// Fixed views in scene units (the body is ~3.6 units tall, feet at y = 0, facing +z).
const VIEWS = {
  brain: { target: [0, 3.45, 0.0], offset: [0.95, 0.12, 0.95] },
  eyes: { target: [0.03, 3.4, 0.12], offset: [0.28, 0.04, 0.62] },
  jaw: { target: [0.07, 3.2, 0.05], offset: [0.55, 0.02, 0.55] },
  lungs: { target: [0.025, 2.72, 0], offset: [0.14, 0.04, 1.72] },
};
// Which wearable site to highlight and orbit for each organ.
const SITE_OF = { heart: "carotid", lungs: "carotid", finger: "finger", wrist: "wrist", brain: "forehead", eyes: "forehead", jaw: "ear" };

// Muse headband (not part of Plethscape): electrode sites as azimuth around the head (degrees, 0 = straight ahead,
// positive toward the person's left, +x) and height. AF7/AF8 sit on the forehead above the outer eyebrows; TP9/TP10
// are rubber pads behind the ears. The band runs across the forehead and rests on top of the ears like glasses.
const MUSE_SITES = { TP9: [112, 3.375], AF7: [38, 3.478], AF8: [-38, 3.478], TP10: [-112, 3.375] };
const MUSE_PATH = [[-112, 3.375], [-100, 3.405], [-86, 3.445], [-62, 3.47], [-38, 3.478], [-18, 3.482], [0, 3.483],
  [18, 3.482], [38, 3.478], [62, 3.47], [86, 3.445], [100, 3.405], [112, 3.375]];
export const MUSE_COLORS = { TP9: 0x6fa8f0, AF7: 0xf08a5d, AF8: 0x3cc895, TP10: 0xe8b53a };
const HEAD_ORGANS = new Set(["brain", "eyes", "jaw"]);

function textSprite(THREE, text, color) {
  const c = document.createElement("canvas"); c.width = 128; c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(10,18,16,0.82)"; g.beginPath(); g.roundRect(8, 12, 112, 40, 10); g.fill();
  g.fillStyle = color; g.font = "600 28px ui-monospace, Menlo, monospace"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, 64, 33);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  sp.scale.set(0.09, 0.045, 1); sp.renderOrder = 10;
  return sp;
}

/** Fit a Muse headband to the loaded head: rays from outside find the skin, the band sits just above it. */
function buildMuse(THREE, skin) {
  const ray = new THREE.Raycaster();
  const cast = (from, to) => { ray.set(from, to.clone().sub(from).normalize()); return ray.intersectObject(skin, true)[0]?.point || null; };
  const y0 = 3.47;
  const front = cast(new THREE.Vector3(0, y0, 3), new THREE.Vector3(0, y0, 0));
  const back = cast(new THREE.Vector3(0, y0, -3), new THREE.Vector3(0, y0, 0));
  const zc = front && back ? (front.z + back.z) / 2 : 0.02;
  const left = cast(new THREE.Vector3(3, 3.42, zc), new THREE.Vector3(0, 3.42, zc));
  const right = cast(new THREE.Vector3(-3, 3.42, zc), new THREE.Vector3(0, 3.42, zc));
  const xc = left && right ? (left.x + right.x) / 2 : 0;
  const rx = left && right ? (left.x - right.x) / 2 : 0.155, rz = front && back ? (front.z - back.z) / 2 : 0.19;
  const onHead = ([az, y], lift) => {
    const a = (az * Math.PI) / 180, dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const c = new THREE.Vector3(xc, y, zc);
    const hit = cast(c.clone().add(dir.clone().multiplyScalar(3)), c);
    const p = hit || c.clone().add(new THREE.Vector3(Math.sin(a) * rx, 0, Math.cos(a) * rz));
    const out = p.clone().sub(c).setY(0).normalize();
    return { p: p.clone().add(out.clone().multiplyScalar(lift)), out };
  };
  const group = new THREE.Group(); group.name = "muse";
  const band = new THREE.MeshStandardMaterial({ color: 0x1d2530, roughness: 0.42, metalness: 0.15 });
  const curve = new THREE.CatmullRomCurve3(MUSE_PATH.map((q) => onHead(q, 0.011).p), false, "centripetal");
  group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 140, 0.0085, 10, false), band));
  const pads = {}, labels = {};
  for (const [name, site] of Object.entries(MUSE_SITES)) {
    const { p, out } = onHead(site, 0.006);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a323c, emissive: MUSE_COLORS[name], emissiveIntensity: 0.25, roughness: 0.35 });
    const geo = name.startsWith("AF") ? new THREE.CylinderGeometry(0.019, 0.019, 0.007, 20) : new THREE.SphereGeometry(0.016, 18, 12);
    const pad = new THREE.Mesh(geo, mat);
    pad.position.copy(p);
    pad.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), out);   // disc faces the skin
    group.add(pad); pads[name] = pad;
    const lab = textSprite(THREE, name, "#" + MUSE_COLORS[name].toString(16).padStart(6, "0"));
    lab.position.copy(p.clone().add(out.clone().multiplyScalar(0.07)).add(new THREE.Vector3(0, 0.035, 0)));
    group.add(lab); labels[name] = lab;
  }
  return { group, pads, labels };
}

export function mountBody(host, { state = () => ({}), onPick, onStatus } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true, alpha: true, powerPreference: "high-performance" });
  } catch (e) {
    onStatus?.({ error: "WebGL is not available in this browser." });
    return null;
  }
  const gl = renderer.getContext();
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
  const software = /swiftshader|llvmpipe|software rasterizer/i.test(gpu) || navigator.hardwareConcurrency <= 2;
  renderer.setPixelRatio(software ? 0.5 : Math.min(window.devicePixelRatio, 1.65));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.domElement.setAttribute("aria-label",
    "3D anatomy from BodyParts3D. Drag to orbit, pinch or scroll to zoom. Tap the head, chest, hand or wrist to pick an organ.");
  renderer.domElement.style.touchAction = "none";
  host.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(37, 1, 0.05, 40);
  camera.position.set(...HOME.pos);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...HOME.target);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.08, screenSpacePanning: true, zoomToCursor: true,
    minDistance: 0.12, maxDistance: 8.5, minPolarAngle: 0.3, maxPolarAngle: Math.PI - 0.3 });
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.update();

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new RoomEnvironment();
  const envTarget = pmrem.fromScene(env, 0.03);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.42;
  env.dispose(); pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xf4eee2, 0x17212b, 0.85));
  const key = new THREE.DirectionalLight(0xfff5e7, 2.0); key.position.set(-3, 4, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffbd83, 1.25); rim.position.set(3, 3, -3); scene.add(rim);
  const warm = new THREE.PointLight(0xf59c83, 0.65, 7); warm.position.set(-2, 2, 2); scene.add(warm);

  const anatomy = createAnatomy("male");
  scene.add(anatomy.group);
  const auras = createSensorAuras();
  scene.add(...Object.values(auras.sprites));
  anatomy.wearables.group.visible = false;

  let organ = "body", site = "finger", showWearables = false, loaded = false, disposed = false, muse = null;
  const brainMats = [];
  let flight = null, cycles = 0, breathClock = 0, lastNow = 0, hrNow = 70, flashUntil = 0;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");

  const world = (v) => anatomy.group.localToWorld(v.clone());
  function viewFor(k) {
    if (k === "body") return { pos: new THREE.Vector3(...HOME.pos), target: new THREE.Vector3(...HOME.target) };
    if (k === "heart") {
      const c = world(anatomy.heartCenter), d = Math.max(0.7, 0.45 / camera.aspect);
      return { pos: c.clone().add(new THREE.Vector3(0.25, 0.065, d)), target: c };
    }
    if (k === "finger" || k === "wrist") {
      const c = world(anatomy.sites[k]), s = Math.max(1, 0.8 / camera.aspect);
      const off = k === "finger" ? [0.16, 0.05, 0.42] : [0.2, 0.06, 0.62];
      return { pos: c.clone().add(new THREE.Vector3(...off).multiplyScalar(s)), target: c };
    }
    const v = VIEWS[k];
    const s = Math.max(1, 0.8 / camera.aspect);
    const t = new THREE.Vector3(...v.target);
    return { pos: t.clone().add(new THREE.Vector3(...v.offset).multiplyScalar(s)), target: t };
  }
  function fly(k) {
    const to = viewFor(k);
    if (reduced.matches) { camera.position.copy(to.pos); controls.target.copy(to.target); controls.update(); flight = null; return; }
    flight = { from: camera.position.clone(), to: to.pos, tFrom: controls.target.clone(), tTo: to.target, k: 0 };
  }
  controls.addEventListener("start", () => { flight = null; });

  // Tap to pick: nearest organ anchor to the hit point.
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || !loaded || !onPick) return;
    const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]); down = null;
    if (moved > 6) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects([anatomy.layers.body, anatomy.heart, anatomy.wearables.group, ...(muse ? [muse.group] : [])], true)[0];
    if (!hit) return;
    const anchors = {
      brain: new THREE.Vector3(0, 3.52, -0.02), eyes: new THREE.Vector3(0.03, 3.4, 0.14), jaw: new THREE.Vector3(0.07, 3.2, 0.06),
      heart: world(anatomy.heartCenter), lungs: new THREE.Vector3(0, 2.75, 0.05),
      wrist: world(anatomy.sites.wrist), finger: world(anatomy.sites.finger),
    };
    let best = null, bd = 0.45;
    for (const [k, p] of Object.entries(anchors)) { const d = p.distanceTo(hit.point); if (d < bd) { bd = d; best = k; } }
    if (best) onPick(best);
  });

  let w = 0, h = 0, visible = true;
  const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; });
  io.observe(host);

  renderer.setAnimationLoop((now) => {
    if (disposed) return;
    if (!loaded) {
      onStatus?.({ progress: Number(anatomy.group.userData.loadProgress ?? 0) });
      if (anatomy.group.userData.loadError) { onStatus?.({ error: "Couldn't load the 3D anatomy models." }); renderer.setAnimationLoop(null); return; }
      if (!anatomy.group.userData.bodyLoaded) return;
      anatomy.group.traverse((o) => { if (o.isMesh && o.userData.tissue === "brain") brainMats.push(...[].concat(o.material)); });
      loaded = true; anatomy.setPresentation("atlas"); anatomy.setCutaway(true); anatomy.setGlow("amber");
      try { muse = buildMuse(THREE, anatomy.layers.body); scene.add(muse.group); } catch (e) { console.warn("Muse headband skipped:", e); }
      onStatus?.({ ready: true });
      if (organ !== "body") fly(organ);
    }
    if (!visible || document.hidden) { lastNow = now; return; }
    if (software && now - lastNow < 60) return; // keep software GL from pinning the CPU
    const dt = Math.min(0.1, (now - (lastNow || now)) / 1000); lastNow = now;

    const bw = host.clientWidth, bh = host.clientHeight;
    if (bw && bh && (bw !== w || bh !== h)) { w = bw; h = bh; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }

    // Physiology from the page: live heart rate and (optionally) a breathing trace in 0..1.
    const s = state() || {};
    const running = s.running !== false;
    if (s.hr > 25 && s.hr < 240) hrNow += (s.hr - hrNow) * Math.min(1, dt * 2);
    if (running) { cycles += (dt * hrNow) / 60; breathClock += dt * 0.25; }
    const breathExpansion = s.breath != null ? Math.max(0, Math.min(1, s.breath)) : 0.5 - 0.5 * Math.cos(2 * Math.PI * breathClock);
    const cardiac = { cycles, phase: cycles % 1, heartRate: hrNow, beatKind: "regular", intervalMs: 60000 / hrNow,
      breathPhase: breathClock % 1, breathExpansion, inhaling: breathClock % 1 < 0.5 };
    // Brain glow follows EEG activity the page reports (0..1), e.g. occipital alpha.
    const glow = Math.max(0, Math.min(1, s.brain ?? 0));
    for (const m of brainMats) if (m.emissive) m.emissive.setRGB(0.28 * glow, 0.16 * glow, 0.75 * glow);
    anatomy.setJourney(-1);
    anatomy.setHeartFocus(organ === "heart");
    anatomy.animate(now / 1000, hrNow, "rest", cardiac, false);
    anatomy.wearables.group.visible = showWearables && organ !== "heart";
    anatomy.wearables.setSelected(site);
    anatomy.setFlowFocus(site, organ === "finger" || organ === "wrist" || now < flashUntil);

    if (muse) {   // headband: with the wearables, or whenever the view is on the head (the EEG channels are Muse's)
      const head = HEAD_ORGANS.has(organ);
      muse.group.visible = showWearables || head;
      const act = s.muse || {};
      for (const [name, pad] of Object.entries(muse.pads)) pad.material.emissiveIntensity = 0.25 + 1.6 * Math.max(0, Math.min(1, act[name] ?? 0));
      for (const lab of Object.values(muse.labels)) lab.visible = head;
    }

    const t = now / 1000;
    auras.update(t, site, null, organ !== "body", reduced.matches, cardiac.phase);
    for (const id of WEARABLE_SITES) {
      const sp = auras.sprites[id];
      sp.position.copy(world(anatomy.sites[id]));
      sp.visible = showWearables && organ !== "heart";
    }

    if (flight) {
      flight.k = Math.min(1, flight.k + dt / 0.85);
      const e = flight.k * flight.k * (3 - 2 * flight.k);
      camera.position.lerpVectors(flight.from, flight.to, e);
      controls.target.lerpVectors(flight.tFrom, flight.tTo, e);
      if (flight.k >= 1) flight = null;
    }
    controls.update(dt);
    renderer.render(scene, camera);
  });

  return {
    focus(k) { organ = k; site = SITE_OF[k] || site; if (loaded) fly(k); },
    flash(k) { site = SITE_OF[k] || site; flashUntil = performance.now() + 2500; },
    setWearables(on) { showWearables = !!on; },
    setLayer(name, on) { if (anatomy.layers[name]) anatomy.layers[name].visible = !!on; },
    reset() { this.focus("body"); },
    dispose() {
      disposed = true; renderer.setAnimationLoop(null); io.disconnect(); controls.dispose();
      if (muse) muse.group.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
      auras.dispose(); anatomy.dispose(); envTarget.dispose(); renderer.dispose(); renderer.domElement.remove();
    },
  };
}
