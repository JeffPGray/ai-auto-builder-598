#!/usr/bin/env node
/**
 * Render one client's hero clip.
 *
 * MEASURED on this machine (Apple M4), against a real client's gathered photos:
 *   3 photos ->  6.4s clip, 4.0s wall
 *   4 photos ->  8.3s clip, 942 KB at crf 36, 4.3s wall   <- the default
 *   5 photos -> 10.2s clip, 5.3s wall
 * Poster is 128 KB. Two consecutive renders are BYTE-IDENTICAL
 * (sha256 faa36732224965a6...), which is the whole argument for this lane over a
 * generative vendor. Four is the default because 777 KB is roughly a 12% page-weight
 * increase on a 4.7 MB page, against 36.3 MB for the hero video Gray Reserve
 * currently ships.
 *
 *   node services/hero-video/render.mjs --slug <slug> [--max-images 5]
 *
 * Reads photos from   clients/<slug>/site/public/images/
 * Writes              clients/<slug>/site/public/hero.mp4
 *                     clients/<slug>/site/public/hero-poster.jpg
 *
 * ── DESIGN NOTES ───────────────────────────────────────────────────────────────
 *
 * RENDERS LOCALLY, NOT ON LAMBDA. Measured: 3.8s warm for a 5s 720p clip on an
 * M4, which is ~5 minutes of wall clock across 75 builds a day. Remotion Lambda
 * would cost about $0.0015/render (~$3.40/month at 2,250 builds) and in exchange
 * adds an S3 bucket, a deployed Lambda, an IAM role, region pinning, and a function
 * re-deploy on every Remotion version bump. Paying that to save five minutes of
 * free local CPU is a bad trade. Revisit only if builds move somewhere with no CPU
 * headroom.
 *
 * BUNDLES ONCE, RENDERS IN-PROCESS. Shelling `npx remotion render` per clip pays
 * the bundle and Chrome launch every time (11.5s cold vs 3.8s warm). This script
 * is written so a batch runner can import `renderHero` and reuse one bundle.
 *
 * FAILS SOFT, LOUDLY. If anything goes wrong it exits 2 and writes nothing. The
 * calling build step treats a non-zero exit as "ship the static hero" and carries
 * on. A build must never block on the video, and must never ship a half-written
 * mp4 — the hero video is a nice-to-have on a site whose job is to get a phone
 * call. That is the opposite of the Higgsfield failure, where degradation was
 * silent and five real prospect builds shipped with no hero video and nobody knew.
 */
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const HERE = path.dirname(new URL(import.meta.url).pathname);
const APP_ROOT = path.resolve(HERE, "..", "..");

// Photos that make a bad hero: logos, icons, anything tiny or near-square-tiny.
const USABLE = /\.(jpe?g|png|webp)$/i;
const isUsable = (file, full) => {
  if (!USABLE.test(file)) return false;
  if (/logo|icon|favicon|badge/i.test(file)) return false;
  return statSync(full).size > 40_000; // below this it is a sprite, not a photograph
};

export async function renderHero({ slug, maxImages = 4, serveUrl, siteDirOverride }) {
  // `siteDirOverride` exists so the pipeline can be exercised against a scratch copy
  // without writing into a real client folder. Production always passes a slug.
  const siteDir = siteDirOverride || path.join(APP_ROOT, "clients", slug, "site");
  const imgDir = path.join(siteDir, "public", "images");
  if (!existsSync(imgDir)) throw new Error(`no images dir: ${imgDir}`);

  const images = readdirSync(imgDir)
    .filter((f) => isUsable(f, path.join(imgDir, f)))
    .sort()
    .slice(0, maxImages)
    .map((f) => `images/${f}`); // relative to publicDir; resolved via staticFile()

  // Three is the floor. Two photos cross-dissolving reads as a broken slideshow,
  // not as motion; below that, ship the static hero.
  if (images.length < 3) {
    throw new Error(`only ${images.length} usable photo(s); need at least 3 for a hero clip`);
  }

  // Output cache (Fable consult, 2026-08-18): a resume/redispatch of the SAME client with an
  // UNCHANGED photo set re-renders from scratch even though this file's own header already proves
  // two renders of identical input are byte-identical. Skip if both output files already exist and
  // are newer than every selected source photo — the exact class of freshness check already
  // shipped tonight for node_modules/images/QA rebuilds, applied here for the same reason. This is
  // per-client only (never cross-client — a shared bundle/publicDir cache was considered and
  // rejected: it would need verifying Remotion resolves staticFile() fresh from the RENDER call's
  // own publicDir rather than baking it into the bundle, and a wrong answer there means one
  // client's photos silently rendering into another client's hero video, which is not a risk worth
  // ~7s/build for).
  const cachedOut = path.join(siteDir, "public", "hero.mp4");
  const cachedPoster = path.join(siteDir, "public", "hero-poster.jpg");
  if (!serveUrl && existsSync(cachedOut) && existsSync(cachedPoster)) {
    const outMtime = Math.min(statSync(cachedOut).mtimeMs, statSync(cachedPoster).mtimeMs);
    const allSourcesOlder = images.every(
      (rel) => statSync(path.join(siteDir, "public", rel)).mtimeMs <= outMtime
    );
    if (allSourcesOlder) {
      console.log(`hero-video: cache hit — ${cachedOut} already newer than every selected photo, skipping render`);
      // Match the real render path's return shape exactly (images/frames/bundled) so the CLI
      // entry's status line and any other caller reading these fields behave identically on a
      // cache hit vs a real render — frames isn't cheaply knowable without decoding the file, but
      // it's cosmetic-only (only printed in the OK log line), so a marker string is fine here.
      return { out: cachedOut, poster: cachedPoster, images: images.length, frames: "cached", bundled: null };
    }
  }

  // publicDir is the client's own public/ folder, so the composition sees exactly
  // the same asset paths the finished site will use.
  const publicDir = path.join(siteDir, "public");
  const bundled =
    serveUrl ||
    (await bundle({ entryPoint: path.join(HERE, "src", "index.ts"), publicDir }));
  const inputProps = {
    images,
    secondsPerImage: 2.6,
    crossfadeSeconds: 0.7,
    // NO scrim baked into the clip. The hero section already lays its own uniform
    // wash over the media (the build skill mandates one so cream text stays
    // legible). Baking a second 0.55 wash into the video double-darkens the frame
    // to mud — visible in the first render of this pipeline. The scrim is the
    // page's job; the clip stays a clean photograph.
    scrimOpacity: 0,
  };
  const composition = await selectComposition({ serveUrl: bundled, id: "Hero", inputProps });

  mkdirSync(path.join(siteDir, "public"), { recursive: true });
  const out = path.join(siteDir, "public", "hero.mp4");
  const poster = path.join(siteDir, "public", "hero-poster.jpg");

  await renderMedia({
    composition,
    serveUrl: bundled,
    codec: "h264",
    // NEVER leave this at Remotion's default CRF 18 — that is how a short clip
    // becomes double-digit MB. Measured on this pipeline, 4 photos / 8.3s / 720p:
    //   crf 34 -> 1121 KB
    //   crf 36 ->  942 KB   <- the default
    //   crf 38 ->  814 KB
    // 36 is the pick rather than 38 because the clip now ships WITHOUT a baked
    // scrim, so a site with a light hero wash would start to show blockiness at 38.
    // If page weight matters more than a little softness, 38 or `--max-images 3`
    // (~6.4s) are the two levers, in that order.
    crf: 36,
    audioCodec: null,
    outputLocation: out,
    inputProps,
    // Per the remotion-renderer skill's performance rules: concurrency tracks the
    // core count. Hardcoding 8 under-uses a 10-core M4 and over-subscribes a 2-core
    // CI runner, which is where these builds actually run.
    concurrency: Math.max(1, Math.min(os.cpus().length, 16)),
    publicDir,
  });

  // Poster is the LCP element, so it must exist and must be the FIRST frame of the
  // video. Chrome treats a <video> poster as the LCP candidate; if the poster and
  // the first frame disagree the hero visibly jumps when playback starts.
  await renderStill({
    composition,
    serveUrl: bundled,
    output: poster,
    frame: 0,
    inputProps,
    imageFormat: "jpeg",
    jpegQuality: 78,
    publicDir,
  });

  return { out, poster, images: images.length, frames: composition.durationInFrames, bundled };
}

// CLI entry
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const slug = arg("slug");
  if (!slug) {
    console.error("usage: node services/hero-video/render.mjs --slug <slug> [--max-images 5]");
    process.exit(2);
  }
  const started = Date.now();
  renderHero({ slug, maxImages: Number(arg("max-images", 4)), siteDirOverride: arg("site-dir") })
    .then((r) => {
      const kb = (statSync(r.out).size / 1024).toFixed(0);
      const pkb = (statSync(r.poster).size / 1024).toFixed(0);
      console.log(
        `HERO_VIDEO=OK slug=${slug} photos=${r.images} frames=${r.frames} ` +
          `mp4=${kb}KB poster=${pkb}KB wall=${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
    })
    .catch((e) => {
      // Loud, specific, and non-zero. The build step reads this and ships the
      // static hero rather than pretending a video exists.
      console.error(`HERO_VIDEO=FAIL slug=${slug} reason=${e.message}`);
      process.exit(2);
    });
}
