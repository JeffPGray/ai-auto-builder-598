#!/usr/bin/env node
/**
 * verify-hero-video.mjs --slug <client-slug>
 *
 * Prove the hero video actually PLAYS in a browser, and prove the failure modes.
 *
 * "The file is 777 KB and the tag is in the HTML" is not evidence — that is exactly
 * the level of proof under which five Gray Reserve builds shipped with no working
 * hero video at all. This reads readyState/paused/currentTime off the live element
 * and screenshots the frame at several playback positions.
 *
 * WHY THIS WAS DEAD AND WAS REPAIRED 2026-08-18: the original version hardcoded a port
 * (4177) and a scratchpad output path from a previous session's own temp directory —
 * neither generalised to a real client, so it was wired into nothing and nothing ever
 * ran it. Repaired to take --slug, read the client's own QA port
 * (clients/<slug>/site/.qa-port, written by the same QA harness every other check
 * uses), write screenshots under clients/<slug>/data/, and — the part that actually
 * lets this gate anything — print a definitive HERO_VIDEO_PLAYBACK_CHECK=PASS|FAIL|SKIP
 * line with a matching exit code. The old version printed JSON and exited 0
 * unconditionally, so even wired in it could not have failed a build.
 *
 * SKIP is correct, not a failure, when status.md records HERO_VIDEO=FAIL (build/SKILL.md's
 * mandatory-attempt gate already distinguishes "never attempted" from "legitimately
 * degraded, fewer than 3 usable photos" — this script trusts that record rather than
 * re-deriving it, and only runs the real playback probe when a clip should exist).
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const slugIdx = args.indexOf("--slug");
const slug = slugIdx !== -1 ? args[slugIdx + 1] : null;
if (!slug) {
  console.log("HERO_VIDEO_PLAYBACK_CHECK=FAIL — usage: verify-hero-video.mjs --slug <client-slug>");
  process.exit(1);
}

const REPO_ROOT = join(import.meta.dirname, "..");
const CLIENT_DIR = join(REPO_ROOT, "clients", slug);
const SITE_DIR = join(CLIENT_DIR, "site");
const STATUS_MD = join(CLIENT_DIR, "data", "status.md");
const OUT = join(CLIENT_DIR, "data", "hero-video-shots");

// Trust the recorded attempt over re-deriving it. A build with a legitimate <3-photo
// degradation records HERO_VIDEO=FAIL and correctly ships poster-only — this script's
// job is proving PLAYBACK, not re-litigating whether a clip should exist at all.
if (!existsSync(STATUS_MD)) {
  console.log(`HERO_VIDEO_PLAYBACK_CHECK=FAIL — ${STATUS_MD} does not exist`);
  process.exit(1);
}
const status = readFileSync(STATUS_MD, "utf8");
const recorded = status.match(/^HERO_VIDEO=(OK|FAIL)/m);
if (!recorded) {
  console.log(
    "HERO_VIDEO_PLAYBACK_CHECK=FAIL — status.md has no recorded HERO_VIDEO=OK|FAIL line " +
    "(build/SKILL.md's hero-video step should already be failing this build for the same reason).",
  );
  process.exit(1);
}
if (recorded[1] === "FAIL") {
  console.log("HERO_VIDEO_PLAYBACK_CHECK=SKIP — status.md records HERO_VIDEO=FAIL (legitimate poster-only degradation, nothing to play).");
  process.exit(0);
}

const portFile = join(SITE_DIR, ".qa-port");
if (!existsSync(portFile)) {
  console.log(`HERO_VIDEO_PLAYBACK_CHECK=FAIL — ${portFile} not found. Start the QA static server first (the same one every other Step 3 check reuses).`);
  process.exit(1);
}
const port = readFileSync(portFile, "utf8").trim();
const SITE = `http://localhost:${port}`;
mkdirSync(OUT, { recursive: true });

// A GATE MUST ALWAYS EMIT A VERDICT. Measured 2026-08-19: a 30s Playwright timeout below threw
// past every `if` in this file, so the run ended with a stack trace and no
// HERO_VIDEO_PLAYBACK_CHECK= line — and the QA agent, which greps for that token, found nothing to
// gate on. Silence reads as "no news", which is the single most dangerous verdict a check can
// return. Any crash from here on is a FAIL with a named reason and exit 1.
const fatal = (e) => {
  console.log(
    `HERO_VIDEO_PLAYBACK_CHECK=FAIL — the check itself crashed (${e && e.message ? e.message.split("\n")[0] : e}). ` +
    "Treat as a hard failure: a gate that cannot complete has not cleared anything.",
  );
  process.exit(1);
};
process.on("uncaughtException", fatal);
process.on("unhandledRejection", fatal);

const browser = await chromium.launch();
const probe = (page) =>
  page.evaluate(() => {
    const v = document.querySelector("video");
    if (!v) return { present: false };
    return {
      present: true,
      readyState: v.readyState,
      paused: v.paused,
      currentTime: Number(v.currentTime.toFixed(2)),
      duration: Number.isFinite(v.duration) ? Number(v.duration.toFixed(2)) : null,
      videoWidth: v.videoWidth,
      videoHeight: v.videoHeight,
      preload: v.preload,
      hasControl: Boolean(
        [...document.querySelectorAll("button")].find((b) => /background/i.test(b.textContent || "")),
      ),
    };
  });

// --- normal visitor ---
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(SITE, { waitUntil: "load" });
await page.waitForTimeout(2500);
const t1 = await probe(page);
await page.screenshot({ path: `${OUT}/hero-video-t1.png`, clip: { x: 0, y: 0, width: 1440, height: 900 } });
await page.waitForTimeout(3000);
const t2 = await probe(page);
await page.screenshot({ path: `${OUT}/hero-video-t2.png`, clip: { x: 0, y: 0, width: 1440, height: 900 } });

// --- WCAG 2.2.2 pause control actually pauses ---
// The control is CORRECTLY built as `sr-only focus:not-sr-only` — invisible until focused, which
// is the standard skip-link pattern and exactly what a keyboard user gets. Playwright's
// actionability check therefore never settles on a plain .click(): the element reports "visible,
// enabled and stable" but "outside of the viewport" forever, and the call times out after 30s.
// Measured 2026-08-19: that timeout threw an UNCAUGHT exception, so this gate printed a raw stack
// trace and NO HERO_VIDEO_PLAYBACK_CHECK= line at all — a gate that emits no verdict cannot fail a
// build, it just gets scrolled past in a log. Focus first (the real keyboard path, which is what
// makes the control take layout), then click.
let paused = null;
const btn = page.getByRole("button", { name: /background/i });
if (await btn.count()) {
  await btn.focus();
  await page.waitForTimeout(150);
  await btn.click({ timeout: 5000 }).catch(() => btn.press("Enter").catch(() => {}));
  await page.waitForTimeout(800);
  paused = await probe(page);
}

// --- reduced motion must never fetch the video ---
const rm = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const rmRequests = [];
rm.on("request", (r) => {
  if (r.url().endsWith(".mp4")) rmRequests.push(r.url());
});
await rm.goto(SITE, { waitUntil: "load" });
await rm.waitForTimeout(2500);
const rmProbe = await probe(rm);
await rm.screenshot({ path: `${OUT}/hero-video-reduced-motion.png`, clip: { x: 0, y: 0, width: 1440, height: 900 } });
await browser.close();

const result = { t1, t2, afterPauseClick: paused, reducedMotion: { probe: rmProbe, mp4Requests: rmRequests } };
console.log(JSON.stringify(result, null, 2));

const failures = [];
if (!t1.present) failures.push("no <video> element found, but status.md claims HERO_VIDEO=OK");
// Loop-aware advance: a short looping clip can wrap between probes (t2 < t1) while still
// playing. Measured on aquaklear-ms 5.04s Seedance — raw t2<=t1 false-failed healthy heroes.
function playbackAdvanced(a, b) {
  if (!a?.present || !b?.present) return false;
  if (b.paused) return false;
  if (typeof b.readyState === "number" && b.readyState < 2) return false;
  if (b.currentTime > a.currentTime + 0.15) return true;
  const d = a.duration || b.duration;
  if (d && d > 1 && b.currentTime < a.currentTime) {
    const traveled = d - a.currentTime + b.currentTime;
    return traveled >= 0.45;
  }
  return false;
}
if (t1.present && t2.present && !playbackAdvanced(t1, t2)) {
  failures.push(
    `playback did not advance (t1=${t1.currentTime}s, t2=${t2.currentTime}s` +
      `${t1.duration != null ? `, dur=${t1.duration}s` : ""}) — video is present but not actually playing`,
  );
}
if (t1.present && !t1.hasControl && !t2.hasControl) failures.push("no WCAG 2.2.2 pause/play control found — required for autoplaying motion over 5s");
if (paused && paused.present && !paused.paused) failures.push("pause control clicked but video did not pause");
if (rmRequests.length) failures.push(`reduced-motion visitor fetched the video anyway (${rmRequests.length} request(s)) — should serve poster only`);

if (failures.length) {
  console.log(`HERO_VIDEO_PLAYBACK_CHECK=FAIL — ${failures.join("; ")}`);
  process.exit(1);
}
console.log("HERO_VIDEO_PLAYBACK_CHECK=PASS — video present, playing, pause control works, reduced-motion visitors fetch no video.");
process.exit(0);
