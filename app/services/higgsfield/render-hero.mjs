#!/usr/bin/env node
/**
 * Hero video: Higgsfield cinematic generate first, Remotion Ken Burns fallback.
 *
 * Contract (byte-compatible with services/hero-video/render.mjs):
 *   Writes  clients/<slug>/site/public/hero.mp4
 *           clients/<slug>/site/public/hero-poster.jpg
 *   Prints  HERO_VIDEO=OK …  or  HERO_VIDEO=FAIL …
 *   Exit 0 on OK, 2 on FAIL (nothing half-written).
 *
 *   node services/higgsfield/render-hero.mjs --slug <slug> [--force] [--skip-hf]
 *     [--prompt "…"] [--ref] [--lock-still]
 *
 * Policy (2026-08-21):
 *   Prompt Seedance (or HF_HERO_MODEL) for a STUNNING hero. Cleared client photos
 *   are optional references — not a locked start frame. Default is text→video.
 *   --ref / HF_HERO_REF=1     → pass best still as --image (soft reference)
 *   --lock-still / HF_HERO_LOCK_STILL=1 → start_image i2v (rare; when fidelity > craft)
 *   Remotion is the loud fallback when HF fails — never silent, never stock Pexels.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  APP_ROOT,
  accountStatus,
  downloadFile,
  hfJson,
  listUsablePhotos,
  pickHeroStill,
  warnIfLowCredits,
  writePosterFromVideo,
} from "./lib.mjs";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const hasFlag = (name) => process.argv.includes(`--${name}`);

/** Default: cinematic t2v — not a Ken Burns of their still. */
const DEFAULT_PROMPT =
  "Cinematic hero shot of a modern aerobic wastewater treatment plant at golden hour, " +
  "compact concrete tank with green access lids in a Mississippi industrial yard, " +
  "slow dramatic orbit and push-in, volumetric light, shallow depth of field, " +
  "photoreal, premium documentary grade, no text, no logos, no people, no watermark";

function fail(slug, reason) {
  console.error(`HERO_VIDEO=FAIL slug=${slug} reason=${reason}`);
  process.exit(2);
}

function remotionFallback(slug, maxImages, siteDir) {
  const script = path.join(APP_ROOT, "services", "hero-video", "render.mjs");
  const args = [script, "--slug", slug, "--max-images", String(maxImages)];
  if (siteDir) args.push("--site-dir", siteDir);
  const r = spawnSync(process.execPath, args, {
    cwd: APP_ROOT,
    encoding: "utf8",
    env: process.env,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    process.exit(r.status || 2);
  }
}

function readClientHeroPrompt(siteDir) {
  // Optional per-client override: clients/<slug>/data/hero-prompt.txt
  const p = path.join(siteDir, "..", "data", "hero-prompt.txt");
  if (!existsSync(p)) return null;
  try {
    const t = readFileSync(p, "utf8").trim();
    return t || null;
  } catch {
    return null;
  }
}

function readHeroPlan(slug) {
  const p = path.join(APP_ROOT, "clients", slug, "data", "image-plan.json");
  if (!existsSync(p)) return null;
  try {
    const plan = JSON.parse(readFileSync(p, "utf8"));
    return (plan.slots || []).find((s) => s.id === "hero" || s.role === "hero-video") || null;
  } catch {
    return null;
  }
}

function resolveRefStill(imgDir, refStem, photos) {
  if (refStem) {
    for (const ext of [".webp", ".jpg", ".jpeg", ".png"]) {
      const full = path.join(imgDir, `${refStem}${ext}`);
      if (existsSync(full)) return { file: `${refStem}${ext}`, full };
    }
  }
  return photos.length ? pickHeroStill(photos) : null;
}

async function tryHiggsfieldHero({ slug, siteDir, force, promptOverride, useRef, lockStill }) {
  const publicDir = path.join(siteDir, "public");
  const imgDir = path.join(publicDir, "images");
  const outMp4 = path.join(publicDir, "hero.mp4");
  const outPoster = path.join(publicDir, "hero-poster.jpg");
  const metaPath = path.join(publicDir, "hero-hf.json");

  const heroSlot = readHeroPlan(slug);
  const photos = listUsablePhotos(imgDir);
  const still = resolveRefStill(imgDir, heroSlot?.refStem, photos);

  const prompt =
    promptOverride ||
    process.env.HF_HERO_PROMPT ||
    (heroSlot?.promptFile
      ? (() => {
          const pp = path.join(siteDir, "..", "data", heroSlot.promptFile);
          if (existsSync(pp)) {
            const t = readFileSync(pp, "utf8").trim();
            return t || null;
          }
          return null;
        })()
      : null) ||
    readClientHeroPrompt(siteDir) ||
    DEFAULT_PROMPT;

  const planMode = heroSlot?.mode; // t2v | ref | lock-still
  const effectiveLock =
    lockStill || planMode === "lock-still" || process.env.HF_HERO_LOCK_STILL === "1";
  const effectiveRef =
    !effectiveLock &&
    (useRef || planMode === "ref" || process.env.HF_HERO_REF === "1");
  const modeTag = effectiveLock ? "lock-still" : effectiveRef ? "ref" : "t2v";

  if (!force && existsSync(outMp4) && existsSync(outPoster) && existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      if (meta.source === "higgsfield" && meta.prompt === prompt && meta.mode === modeTag) {
        const kb = (statSync(outMp4).size / 1024).toFixed(0);
        const pkb = (statSync(outPoster).size / 1024).toFixed(0);
        console.log(
          `HERO_VIDEO=OK slug=${slug} source=higgsfield cache=1 mode=${modeTag} ` +
            `mp4=${kb}KB poster=${pkb}KB`,
        );
        return { cached: true };
      }
    } catch {
      /* regenerate */
    }
  }

  let status;
  try {
    status = accountStatus();
  } catch (e) {
    throw new Error(`HF auth/workspace: ${e.message}`);
  }
  warnIfLowCredits(status.credits);

  const duration = Number(process.env.HF_HERO_DURATION || 5);
  const resolution = process.env.HF_HERO_RESOLUTION || "720p";
  const mode = process.env.HF_HERO_MODE || "std";
  const model = process.env.HF_HERO_MODEL || "seedance_2_0";

  const args = [
    "generate",
    "create",
    model,
    "--prompt",
    prompt,
    "--duration",
    String(duration),
    "--resolution",
    resolution,
    "--mode",
    mode,
    "--aspect_ratio",
    "16:9",
    "--generate_audio=false",
    "--wait",
    "--wait-timeout",
    "10m",
  ];

  if (effectiveLock) {
    if (!still) throw new Error("lock-still requested but no usable photo");
    args.push("--start-image", still.full);
  } else if (effectiveRef && still) {
    // Soft reference — model may invent the shot; still is guidance only.
    args.push("--image", still.full);
  }

  const started = Date.now();
  const jobs = hfJson(args, { timeoutMs: 11 * 60_000 });
  const job = Array.isArray(jobs) ? jobs[0] : jobs;
  if (!job || job.status !== "completed" || !job.result_url) {
    throw new Error(`HF job incomplete: ${JSON.stringify(job?.status || job)}`);
  }

  mkdirSync(publicDir, { recursive: true });
  const tmpMp4 = path.join(publicDir, `.hero-hf-${process.pid}.mp4`);
  const tmpPoster = path.join(publicDir, `.hero-hf-${process.pid}.jpg`);
  try {
    downloadFile(job.result_url, tmpMp4);
    const posterHow = writePosterFromVideo({
      mp4Path: tmpMp4,
      posterPath: tmpPoster,
      thumbnailUrl: job.thumbnail_url,
    });
    if (posterHow === "none") {
      throw new Error("could not write hero poster (no ffmpeg, no thumbnail_url)");
    }
    if (existsSync(outMp4)) unlinkSync(outMp4);
    if (existsSync(outPoster)) unlinkSync(outPoster);
    renameSync(tmpMp4, outMp4);
    renameSync(tmpPoster, outPoster);
    writeFileSync(
      metaPath,
      JSON.stringify(
        {
          source: "higgsfield",
          model,
          mode: modeTag,
          still: still?.file || null,
          prompt,
          jobId: job.id,
          creditsAfter: status.credits,
          at: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (e) {
    try {
      if (existsSync(tmpMp4)) unlinkSync(tmpMp4);
      if (existsSync(tmpPoster)) unlinkSync(tmpPoster);
    } catch {
      /* ignore */
    }
    throw e;
  }

  const kb = (statSync(outMp4).size / 1024).toFixed(0);
  const pkb = (statSync(outPoster).size / 1024).toFixed(0);
  console.log(
    `HERO_VIDEO=OK slug=${slug} source=higgsfield model=${model} mode=${modeTag} ` +
      `job=${job.id} mp4=${kb}KB poster=${pkb}KB ` +
      `wall=${((Date.now() - started) / 1000).toFixed(1)}s credits=${status.credits}`,
  );
  return { cached: false, job };
}

const slug = arg("slug");
if (!slug) {
  console.error(
    "usage: node services/higgsfield/render-hero.mjs --slug <slug> [--force] [--skip-hf] [--ref] [--lock-still] [--prompt \"…\"]",
  );
  process.exit(2);
}

const maxImages = Number(arg("max-images", 4));
const siteDirOverride = arg("site-dir");
const siteDir = siteDirOverride || path.join(APP_ROOT, "clients", slug, "site");
const skipHf = hasFlag("skip-hf") || process.env.HF_HERO === "0";
const force = hasFlag("force");
const useRef = hasFlag("ref") || process.env.HF_HERO_REF === "1";
const lockStill = hasFlag("lock-still") || process.env.HF_HERO_LOCK_STILL === "1";
const promptOverride = arg("prompt");

(async () => {
  if (skipHf) {
    remotionFallback(slug, maxImages, siteDirOverride);
    return;
  }
  try {
    await tryHiggsfieldHero({
      slug,
      siteDir,
      force,
      promptOverride,
      useRef,
      lockStill,
    });
  } catch (e) {
    console.warn(`[higgsfield] hero failed → Remotion fallback: ${e.message}`);
    remotionFallback(slug, maxImages, siteDirOverride);
  }
})().catch((e) => fail(slug, e.message));
