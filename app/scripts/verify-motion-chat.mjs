/**
 * Visual verification.
 *
 * Deliberately measures reveal state at MULTIPLE scroll depths. Gray Reserve has
 * shipped a scroll-reveal defect that passed verification because the check ran at
 * the top of the page while everything below it was invisible. So this reports the
 * computed opacity of every [data-reveal] section at every depth, and screenshots
 * each one for a human to look at.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const SITE = "http://localhost:4177";
const OUT = "/private/tmp/claude-501/-/44f3d068-7901-4185-b520-bdc0c8e19e14/scratchpad/shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.text().includes("[motion]")) consoleErrors.push(`${m.type()}: ${m.text()}`);
});

await page.goto(SITE, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

const probe = () =>
  page.evaluate(() => {
    const rows = [...document.querySelectorAll("[data-reveal]")].map((el, i) => {
      const r = el.getBoundingClientRect();
      return {
        i,
        opacity: Number(getComputedStyle(el).opacity).toFixed(2),
        transform: getComputedStyle(el).transform === "none" ? "none" : "moved",
        onScreen: r.top < innerHeight && r.bottom > 0,
        text: (el.textContent || "").trim().slice(0, 42).replace(/\s+/g, " "),
      };
    });
    const heroImg = document.querySelector("[data-hero-media]");
    return {
      motionAttr: document.documentElement.getAttribute("data-motion"),
      lenisClass: document.documentElement.className.includes("lenis"),
      navScrolled: document.querySelector("[data-nav]")?.dataset.scrolled ?? "unset",
      heroTransform: heroImg ? getComputedStyle(heroImg).transform.slice(0, 46) : "n/a",
      scrollY: Math.round(window.scrollY),
      docHeight: document.documentElement.scrollHeight,
      rows,
    };
  });

const depths = [0, 900, 1800, 2800, 4000, 5200];
const report = [];
for (const y of depths) {
  await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: "instant" }), y);
  await page.waitForTimeout(1100); // let Lenis settle and triggers fire
  const p = await probe();
  report.push({ requested: y, ...p });
  await page.screenshot({ path: `${OUT}/desktop-scroll-${String(y).padStart(4, "0")}.png` });
}

// ---- Chat widget, driven exactly as a visitor would ----
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
await page.waitForTimeout(600);
await page.getByRole("button", { name: /Chat with/i }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/chat-01-open.png` });

await page.fill("#site-chat-input", "do you do irrigation, and are you licensed?");
await page.screenshot({ path: `${OUT}/chat-02-typed.png` });
await page.getByRole("button", { name: "Send message" }).click();
await page.waitForFunction(
  () => document.querySelectorAll('[role="dialog"] p').length >= 5,
  { timeout: 20000 },
);
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/chat-03-answered.png` });

const transcript = await page.evaluate(() =>
  [...document.querySelectorAll('[role="dialog"] p')].map((p) => p.textContent),
);

// ---- Mobile ----
const m = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 3 });
await m.goto(SITE, { waitUntil: "networkidle" });
await m.waitForTimeout(1200);
await m.screenshot({ path: `${OUT}/mobile-scroll-0000.png` });
await m.evaluate(() => window.scrollTo({ top: 3000, behavior: "instant" }));
await m.waitForTimeout(1100);
await m.screenshot({ path: `${OUT}/mobile-scroll-3000.png` });

// ---- Reduced motion: nothing may ever be hidden ----
const rm = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});
await rm.goto(SITE, { waitUntil: "networkidle" });
await rm.waitForTimeout(900);
const rmProbe = await rm.evaluate(() => ({
  motionAttr: document.documentElement.getAttribute("data-motion"),
  minOpacity: Math.min(
    ...[...document.querySelectorAll("[data-reveal]")].map((el) =>
      Number(getComputedStyle(el).opacity),
    ),
  ),
}));
await rm.evaluate(() => window.scrollTo({ top: 2800, behavior: "instant" }));
await rm.waitForTimeout(500);
await rm.screenshot({ path: `${OUT}/reduced-motion-scroll-2800.png` });

// ---- JS DISABLED: the fail-open guarantee ----
const noJsCtx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
const nj = await noJsCtx.newPage();
await nj.goto(SITE, { waitUntil: "load" });
await nj.waitForTimeout(600);
const njProbe = await nj.evaluate?.(() => 1).catch(() => "js off (expected)");
await nj.evaluate?.(() => {}).catch(() => {});
await nj.screenshot({ path: `${OUT}/nojs-scroll-0000.png` });
// Scroll without JS via keyboard
await nj.keyboard.press("End");
await nj.waitForTimeout(500);
await nj.screenshot({ path: `${OUT}/nojs-scroll-end.png` });

console.log(JSON.stringify({ report, transcript, rmProbe, njProbe, consoleErrors }, null, 2));
await browser.close();
