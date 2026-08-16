#!/usr/bin/env node
/**
 * fb-logo.js - download a public Facebook page's profile image (the business logo candidate).
 *
 * curl/wget are blocked on fbcdn, so we fetch the bytes THROUGH the browser context
 * (inherits the page's headers), which works logged-out. Pair with brand-logo.py to
 * grade/extract, and the gather "Social harvest" step decides whether to keep it.
 *
 * Usage:  node scripts/fb-logo.js <facebook-page-url> <output-path.(jpg|png)>
 * Prints: { ogImage, saved, bytes }   (or { error })  on stdout as JSON
 */
const url = process.argv[2];
const out = process.argv[3];
if (!url || !out || !url.includes("facebook.com")) {
  console.log("Usage: node scripts/fb-logo.js <facebook-page-url> <output-path>");
  process.exit(url && out ? 1 : 0);
}
const fs = require("fs");

(async () => {
  const { chromium } = require("patchright");
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3500);
    const og = await page.evaluate(() => {
      const m = document.querySelector('meta[property="og:image"]');
      return m ? m.content : null;
    });
    if (!og) {
      console.log(JSON.stringify({ error: "no og:image found" }));
      await browser.close(); process.exit(2);
    }
    const resp = await ctx.request.get(og);
    if (!resp.ok()) {
      console.log(JSON.stringify({ error: "image fetch failed", status: resp.status(), ogImage: og }));
      await browser.close(); process.exit(3);
    }
    const buf = await resp.body();
    fs.writeFileSync(out, buf);
    console.log(JSON.stringify({ ogImage: og, saved: out, bytes: buf.length }, null, 2));
    await browser.close();
  } catch (e) {
    console.log(JSON.stringify({ error: String((e && e.message) || e) }));
    try { await browser.close(); } catch (_) {}
    process.exit(4);
  }
})();
