#!/usr/bin/env node
/*
 * Builds vendor/body3d.js and models/ from Plethscape (https://github.com/sontakey/plethscape).
 *
 *   node tools/build-body3d.mjs [path/to/plethscape]
 *
 * Without a path it clones Plethscape at the pinned commit into tools/.plethscape.
 * Output is committed so the site stays a plain static folder with no build step.
 *
 * What it changes in Plethscape (in a temp copy, never upstream):
 *  - The Renderpeople scanned presentation heads are NOT loaded or copied. Their license forbids
 *    redistribution, so the neutral BodyParts3D skin keeps its own head instead.
 *  - Upstream discards all anatomy above the neck (the scan covers it). For neuroscience teaching the
 *    brain, skull and eyes are shown instead.
 *  - import.meta.env.BASE_URL is set to "./" so models load from ./models next to index.html.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PINNED = "83fcf0ca1d8619afc4e802e1e88d180de75c1578";
const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, "..");
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

let src = process.argv[2] && resolve(process.argv[2]);
if (!src) {
  src = join(here, ".plethscape");
  if (!existsSync(src)) {
    run("git", ["clone", "https://github.com/sontakey/plethscape.git", src]);
    run("git", ["checkout", PINNED], src);
  }
}
if (!existsSync(join(src, "node_modules/three"))) run("npm", ["ci", "--ignore-scripts"], src);

// 1) patched copy of the sources
const work = join(here, ".build");
rmSync(work, { recursive: true, force: true });
cpSync(join(src, "src"), join(work, "src"), { recursive: true });
const bp = join(work, "src/bodyparts.ts");
let code = readFileSync(bp, "utf8");
const patch = (from, to) => {
  if (!code.includes(from)) throw new Error("Plethscape changed, patch no longer applies:\n" + from);
  code = code.replace(from, to);
};
patch(
  `loader.loadAsync(
      import.meta.env.BASE_URL +
        (presentation === "female"
          ? "models/scanned-head-female.glb"
          : "models/scanned-head.glb"),
    ),`,
  `Promise.resolve({ scene: new THREE.Group() }), // scanned heads are not redistributable`,
);
patch(
  `if (!scannedHead)
        throw new Error("Scanned presentation head unavailable");`,
  ``,
);
patch(
  `group.userData.headSource =
        presentation === "female"
          ? "Renderpeople Claudia Rigged 002"
          : "Renderpeople Eric Rigged 001";`,
  `group.userData.headSource = scannedHead ? "scanned" : "BodyParts3D neutral skin";`,
);
patch(`if (bakedSkin) {
          // Remove the original head`, `if (bakedSkin && scannedHead) {
          // Remove the original head`);
patch(
  `[fittingSkin.geometry, scannedHead.geometry].map(`,
  `[fittingSkin.geometry, ...(scannedHead ? [scannedHead.geometry] : [])].map(`,
);
// Show the head's own anatomy (brain, skull, eyes, facial muscles): upstream hides it under the scan.
patch(`if (atlasPosition.y > \${tissue === "arteries" ? "3.30" : "3.100"}) discard;`, ``);
patch(`? "discard;"
            : tissue !== "body"
              ? "if (atlasPosition.y > 3.27 && atlasHeartFocus < .5) discard;"
              : ""`, `? ""
            : ""`);
patch(`float gentleHead = smoothstep(3.0,3.10,atlasPosition.y);`, `float gentleHead = 0.;`);
writeFileSync(bp, code);
cpSync(join(here, "body3d/viewer.js"), join(work, "viewer.js"));
symlinkSync(join(src, "node_modules"), join(work, "node_modules"), "dir");

// 2) bundle three.js + Plethscape anatomy + our viewer into one ES module
mkdirSync(join(site, "vendor"), { recursive: true });
run("npx", ["--yes", "esbuild@0.28.2", join(work, "viewer.js"), "--bundle", "--format=esm", "--minify",
  "--target=es2020", "--legal-comments=eof",
  `--define:import.meta.env.BASE_URL="./"`,
  `--outfile=${join(site, "vendor/body3d.js")}`], work);

// 3) models (MIT / CC BY 4.0 / Apache-2.0 only)
const models = join(site, "models");
rmSync(models, { recursive: true, force: true });
mkdirSync(models, { recursive: true });
for (const f of ["bodyparts-atlas.glb", "bodyparts-atlas-metadata.json", "neutral-skin.glb", "draco"])
  cpSync(join(src, "public/models", f), join(models, f), { recursive: true });
cpSync(join(src, "public/ATTRIBUTION.md"), join(models, "PLETHSCAPE-ATTRIBUTION.md"));
cpSync(join(src, "LICENSE"), join(models, "PLETHSCAPE-LICENSE.txt"));
rmSync(work, { recursive: true, force: true });
console.log("Built vendor/body3d.js and models/");
