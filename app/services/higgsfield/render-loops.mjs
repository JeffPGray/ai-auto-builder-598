#!/usr/bin/env node
/**
 * Service / about micro-loops from image-plan hf-loop slots (Tier 2).
 *
 *   node services/higgsfield/render-loops.mjs --slug <slug> [--force]
 *
 * Writes clients/<slug>/site/public/videos/*.mp4 from ref stills (720p, 4s default).
 * Skips optional slots on HF failure. Exit 0 if ≥0 loops OK or none planned.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  APP_ROOT,
  accountStatus,
  downloadFile,
  hfJson,
  postProcessHeroMp4,
  resolveRefStill,
  warnIfLowCredits,
} from "./lib.mjs";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const hasFlag = (name) => process.argv.includes(`--${name}`);

function readPlan(slug) {
  const p = path.join(APP_ROOT, "clients", slug, "data", "image-plan.json");
  if (!existsSync(p)) return [];
  try {
    const plan = JSON.parse(readFileSync(p, "utf8"));
    return (plan.slots || []).filter((s) => s.source === "hf-loop");
  } catch {
    return [];
  }
}

function loopPrompt(role, stem) {
  const s = (stem || "").toLowerCase();
  if (role === "about-video") {
    return (
      "Slow subtle push-in on a professional trade owner at a residential job site, " +
      "golden hour, shallow depth of field, documentary grade, no text, no logos"
    );
  }
  if (/tree|trim|stump/.test(s)) {
    return "Slow motion on tree crew work, subtle camera drift, trade documentary, no text";
  }
  if (/sod|lawn|landscape/.test(s)) {
    return "Slow motion on landscaping work in progress, gentle orbit, no text";
  }
  if (/sprinkler|irrigation/.test(s)) {
    return "Slow motion on sprinkler system in operation, subtle push-in, no text";
  }
  return "Slow cinematic motion on trade work in progress, subtle camera move, no text, no logos";
}

const slug = arg("slug");
if (!slug) {
  console.error("usage: node services/higgsfield/render-loops.mjs --slug <slug> [--force]");
  process.exit(2);
}

const force = hasFlag("force");
const siteDir = path.join(APP_ROOT, "clients", slug, "site");
const publicDir = path.join(siteDir, "public");
const imgDir = path.join(publicDir, "images");
const videoDir = path.join(publicDir, "videos");
mkdirSync(videoDir, { recursive: true });

const slots = readPlan(slug);
if (!slots.length) {
  console.log(`HF_LOOPS=OK slug=${slug} loops=0 planned=0`);
  process.exit(0);
}

let status;
try {
  status = accountStatus();
} catch (e) {
  console.error(`HF_LOOPS=FAIL slug=${slug} reason=${e.message}`);
  process.exit(2);
}
warnIfLowCredits(status.credits);

let ok = 0;
let skip = 0;
let fail = 0;

for (const slot of slots) {
  const outRel = slot.out || `videos/${slot.refStem}.mp4`;
  const outPath = path.join(publicDir, outRel);
  const metaPath = `${outPath}.meta.json`;

  if (!force && existsSync(outPath) && statSync(outPath).size > 20_000) {
    ok++;
    continue;
  }

  const still = resolveRefStill(slug, slot.refStem, imgDir);
  if (!still) {
    if (slot.optional) {
      skip++;
      continue;
    }
    fail++;
    console.warn(`[hf-loop] missing ref ${slot.refStem} slot=${slot.id}`);
    continue;
  }

  const duration = slot.duration || 4;
  const resolution = slot.resolution || "720p";
  const prompt = loopPrompt(slot.role, slot.refStem);

  try {
    const jobs = hfJson(
      [
        "generate",
        "create",
        process.env.HF_LOOP_MODEL || "seedance_2_0",
        "--prompt",
        prompt,
        "--image",
        still.full,
        "--duration",
        String(duration),
        "--resolution",
        resolution,
        "--mode",
        "std",
        "--aspect_ratio",
        "16:9",
        "--generate_audio=false",
        "--wait",
        "--wait-timeout",
        "8m",
      ],
      { timeoutMs: 9 * 60_000 },
    );
    const job = Array.isArray(jobs) ? jobs[0] : jobs;
    if (!job?.result_url) throw new Error(`incomplete job ${job?.status}`);

    mkdirSync(path.dirname(outPath), { recursive: true });
    downloadFile(job.result_url, outPath);
    postProcessHeroMp4(outPath, { maxBytes: 2_500_000 });
    writeFileSync(
      metaPath,
      JSON.stringify(
        {
          source: "higgsfield",
          slot: slot.id,
          role: slot.role,
          still: still.file,
          prompt,
          at: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    ok++;
    console.log(`HF_LOOP=OK slug=${slug} slot=${slot.id} out=${outRel}`);
  } catch (e) {
    if (slot.optional) {
      skip++;
      console.warn(`[hf-loop] skip optional ${slot.id}: ${e.message}`);
    } else {
      fail++;
      console.warn(`[hf-loop] fail ${slot.id}: ${e.message}`);
    }
  }
}

console.log(`HF_LOOPS=OK slug=${slug} ok=${ok} skip=${skip} fail=${fail} planned=${slots.length}`);
process.exit(fail > 0 && ok === 0 ? 2 : 0);
