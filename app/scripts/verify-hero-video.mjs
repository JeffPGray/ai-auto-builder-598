/**
 * Prove the hero video actually PLAYS in a browser, and prove the failure modes.
 *
 * "The file is 777 KB and the tag is in the HTML" is not evidence — that is exactly
 * the level of proof under which five Gray Reserve builds shipped with no working
 * hero video at all. This reads readyState/paused/currentTime off the live element
 * and screenshots the frame at several playback positions.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const SITE = "http://localhost:4177";
const OUT = "/private/tmp/claude-501/-/44f3d068-7901-4185-b520-bdc0c8e19e14/scratchpad/shots";
mkdirSync(OUT, { recursive: true });

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
let paused = null;
const btn = page.getByRole("button", { name: /background/i });
if (await btn.count()) {
  await btn.click();
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

console.log(
  JSON.stringify(
    { t1, t2, afterPauseClick: paused, reducedMotion: { probe: rmProbe, mp4Requests: rmRequests } },
    null,
    2,
  ),
);
await browser.close();
