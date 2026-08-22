#!/usr/bin/env node
/**
 * Thin-shelf stills via Higgsfield i2i (Nano Banana / Flux Kontext).
 *
 * Only for atmosphere veils / grounds — never invents product photography
 * when cleared stills already exist. Writes under site/public/images/ and
 * stamps hero-adjacent meta for audit.
 *
 *   node services/higgsfield/generate-stills.mjs --slug <slug> \
 *     --from product-concrete-tank.webp \
 *     --out measured-veil.webp \
 *     --prompt "…"
 *
 * Policy: thin shelves only. Heroes use render-hero.mjs.
 */
import { existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  APP_ROOT,
  accountStatus,
  downloadFile,
  hfJson,
  warnIfLowCredits,
} from "./lib.mjs";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const slug = arg("slug");
const from = arg("from");
const outName = arg("out");
const prompt = arg("prompt");
const model = arg("model", process.env.HF_STILL_MODEL || "nano_banana");
const aspect = arg("aspect", "16:9");

if (!slug || !from || !outName || !prompt) {
  console.error(
    "usage: node services/higgsfield/generate-stills.mjs --slug <slug> --from <file> --out <file> --prompt \"…\" [--model nano_banana] [--aspect 16:9]",
  );
  process.exit(2);
}

const siteDir = path.join(APP_ROOT, "clients", slug, "site");
const imgDir = path.join(siteDir, "public", "images");
const src = path.isAbsolute(from) ? from : path.join(imgDir, from);
const dest = path.join(imgDir, outName);

if (!existsSync(src)) {
  console.error(`HF_STILL=FAIL slug=${slug} reason=missing source ${src}`);
  process.exit(2);
}

try {
  const status = accountStatus();
  warnIfLowCredits(status.credits);

  const started = Date.now();
  const jobs = hfJson(
    [
      "generate",
      "create",
      model,
      "--prompt",
      prompt,
      "--image",
      src,
      "--aspect_ratio",
      aspect,
      "--wait",
      "--wait-timeout",
      "4m",
    ],
    { timeoutMs: 5 * 60_000 },
  );
  const job = Array.isArray(jobs) ? jobs[0] : jobs;
  if (!job || job.status !== "completed" || !job.result_url) {
    throw new Error(`job incomplete: ${job?.status}`);
  }
  mkdirSync(imgDir, { recursive: true });
  // Prefer min webp if present; else png/jpg result.
  const url = job.min_result_url || job.result_url;
  downloadFile(url, dest);
  const kb = (statSync(dest).size / 1024).toFixed(0);
  writeFileSync(
    path.join(imgDir, `${outName}.hf.json`),
    JSON.stringify(
      { source: "higgsfield", model, from: path.basename(src), jobId: job.id, at: new Date().toISOString() },
      null,
      2,
    ),
  );
  console.log(
    `HF_STILL=OK slug=${slug} model=${model} from=${path.basename(src)} out=${outName} ` +
      `kb=${kb} wall=${((Date.now() - started) / 1000).toFixed(1)}s job=${job.id}`,
  );
} catch (e) {
  console.error(`HF_STILL=FAIL slug=${slug} reason=${e.message}`);
  process.exit(2);
}
