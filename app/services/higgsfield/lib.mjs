#!/usr/bin/env node
/**
 * Shared Higgsfield CLI helpers for Klaudius builds.
 *
 * Auth: OAuth via `higgsfield auth login` → ~/.config/higgsfield/credentials.json
 * (browser once per machine). No silent Pexels-style fallback here — callers decide.
 */
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync, renameSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = path.resolve(HERE, "..", "..");
export const CREDIT_WARN_FLOOR = 500;

const USABLE = /\.(jpe?g|png|webp)$/i;

export function isUsablePhoto(file, full) {
  if (!USABLE.test(file)) return false;
  if (/logo|icon|favicon|badge/i.test(file)) return false;
  try {
    return statSync(full).size > 40_000;
  } catch {
    return false;
  }
}

/** Prefer absolute path to globally installed CLI; fall back to PATH. */
export function resolveHiggsfieldBin() {
  const candidates = [
    process.env.HIGGSFIELD_BIN,
    path.join(homedir(), ".npm-global", "bin", "higgsfield"),
    "/usr/local/bin/higgsfield",
    "higgsfield",
  ].filter(Boolean);
  for (const c of candidates) {
    if (c === "higgsfield") return c;
    if (existsSync(c)) return c;
  }
  return "higgsfield";
}

/**
 * Run `higgsfield …` with --json. Returns parsed JSON or throws.
 * @param {string[]} args
 * @param {{ timeoutMs?: number, cwd?: string }} [opts]
 */
export function hfJson(args, opts = {}) {
  const bin = resolveHiggsfieldBin();
  const timeout = opts.timeoutMs ?? 120_000;
  const r = spawnSync(bin, [...args, "--json"], {
    encoding: "utf8",
    timeout,
    cwd: opts.cwd || APP_ROOT,
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.error) throw new Error(`higgsfield spawn failed: ${r.error.message}`);
  const out = (r.stdout || "").trim();
  const err = (r.stderr || "").trim();
  if (r.status !== 0) {
    throw new Error(err || out || `higgsfield exited ${r.status}`);
  }
  if (!out) throw new Error(`higgsfield returned empty stdout (stderr: ${err})`);
  try {
    return JSON.parse(out);
  } catch (e) {
    throw new Error(`higgsfield JSON parse failed: ${e.message}; out=${out.slice(0, 200)}`);
  }
}

/** Credits + plan. Throws if unauthenticated / no workspace. */
export function accountStatus() {
  return hfJson(["account", "status"], { timeoutMs: 30_000 });
}

/**
 * Warn operator when credits ≤ floor. Uses notify.sh (telegram/slack/email).
 * Never throws — notifications are optional.
 */
export function warnIfLowCredits(credits, floor = CREDIT_WARN_FLOOR) {
  const n = Number(credits);
  if (!Number.isFinite(n) || n > floor) return false;
  const msg = `Higgsfield credits ≤${floor} (now: ${n}) — top up before builds burn the wallet`;
  console.warn(`[higgsfield] ${msg}`);
  const notify = path.join(APP_ROOT, "scripts", "notify.sh");
  if (!existsSync(notify)) return true;
  try {
    spawnSync("bash", [notify, msg], {
      cwd: APP_ROOT,
      env: process.env,
      timeout: 20_000,
    });
  } catch {
    /* optional */
  }
  return true;
}

/**
 * List usable photos under site/public/images (same rules as Remotion).
 * @returns {{ file: string, full: string, size: number }[]}
 */
export function listUsablePhotos(imgDir) {
  if (!existsSync(imgDir)) return [];
  return readdirSync(imgDir)
    .filter((f) => isUsablePhoto(f, path.join(imgDir, f)))
    .map((f) => {
      const full = path.join(imgDir, f);
      return { file: f, full, size: statSync(full).size };
    })
    .sort((a, b) => b.size - a.size);
}

/**
 * Prefer largest landscape work still for HF ref; aqua tank paths stay for wastewater builds.
 */
export function pickHeroStill(photos) {
  if (!photos.length) return null;
  const work = [
    /tree.?trim/i,
    /tree/i,
    /sod/i,
    /landscap/i,
    /crew/i,
    /work/i,
    /install/i,
    /sprinkler/i,
    /drain/i,
    /product/i,
    /concrete.?tank/i,
    /facility/i,
  ];
  for (const re of work) {
    const hit = photos.find((p) => re.test(p.file));
    if (hit) return hit;
  }
  const nonGmaps = photos.filter((p) => !/gmaps|street|maps/i.test(p.file));
  return (nonGmaps[0] || photos[0]);
}

/**
 * Resolve HF reference still: data/images originals first, then public/images.
 * @returns {{ file: string, full: string, size?: number } | null}
 */
export function resolveRefStill(slug, refStem, publicImgDir) {
  const dataDir = path.join(APP_ROOT, "clients", slug, "data", "images");
  const dirs = [dataDir, publicImgDir].filter((d) => existsSync(d));

  if (refStem) {
    for (const dir of dirs) {
      let best = null;
      for (const ext of [".jpg", ".jpeg", ".png", ".webp"]) {
        const full = path.join(dir, `${refStem}${ext}`);
        if (!existsSync(full)) continue;
        const size = statSync(full).size;
        if (!best || size > best.size) best = { file: `${refStem}${ext}`, full, size };
      }
      if (best) return best;
    }
  }

  const photos = [];
  for (const dir of dirs) {
    for (const p of listUsablePhotos(dir)) {
      if (!photos.some((x) => x.file === p.file)) photos.push(p);
    }
  }
  photos.sort((a, b) => b.size - a.size);
  return photos.length ? pickHeroStill(photos) : null;
}

/** Download URL → local path (binary). */
export function downloadFile(url, dest) {
  execFileSync("curl", ["-fsSL", "-o", dest, url], { stdio: "pipe", timeout: 180_000 });
}

/**
 * First-frame poster via ffmpeg if available; else download thumbnail_url.
 * @returns {'ffmpeg'|'thumbnail'|'none'}
 */
export function writePosterFromVideo({ mp4Path, posterPath, thumbnailUrl }) {
  const ffmpeg = which("ffmpeg");
  if (ffmpeg) {
    const r = spawnSync(
      ffmpeg,
      ["-y", "-i", mp4Path, "-frames:v", "1", "-q:v", "3", posterPath],
      { encoding: "utf8" },
    );
    if (r.status === 0 && existsSync(posterPath)) return "ffmpeg";
  }
  if (thumbnailUrl) {
    downloadFile(thumbnailUrl, posterPath);
    if (existsSync(posterPath)) return "thumbnail";
  }
  return "none";
}

function which(cmd) {
  const r = spawnSync("which", [cmd], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
}

/** faststart + optional re-encode when hero mp4 exceeds budget (mobile LCP). */
export function postProcessHeroMp4(mp4Path, { maxBytes = 4_500_000 } = {}) {
  const ffmpeg = which("ffmpeg");
  if (!ffmpeg || !existsSync(mp4Path)) return { action: "skip" };

  const tmp = `${mp4Path}.faststart.mp4`;
  const r1 = spawnSync(
    ffmpeg,
    ["-y", "-i", mp4Path, "-movflags", "+faststart", "-c", "copy", tmp],
    { encoding: "utf8" },
  );
  if (r1.status === 0 && existsSync(tmp)) {
    renameSync(tmp, mp4Path);
  } else if (existsSync(tmp)) {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }

  let size = statSync(mp4Path).size;
  if (size <= maxBytes) return { action: "faststart", bytes: size };

  const enc = `${mp4Path}.enc.mp4`;
  const r2 = spawnSync(
    ffmpeg,
    [
      "-y",
      "-i",
      mp4Path,
      "-movflags",
      "+faststart",
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "28",
      "-pix_fmt",
      "yuv420p",
      "-an",
      enc,
    ],
    { encoding: "utf8" },
  );
  if (r2.status === 0 && existsSync(enc)) {
    renameSync(enc, mp4Path);
    size = statSync(mp4Path).size;
    return { action: "reencode", bytes: size };
  }
  return { action: "faststart", bytes: size };
}
