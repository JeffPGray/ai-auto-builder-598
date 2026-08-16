#!/usr/bin/env node
/**
 * Yahoo Search helper — handles consent wall automatically
 *
 * Usage:
 *   node scripts/yahoo-search.js "Business Name location reviews"
 *
 * Returns the search results page text, stripped of ads and boilerplate.
 */

const { chromium } = require("patchright");

const query = process.argv.slice(2).join(" ");
if (!query) {
  console.log("Usage: node scripts/yahoo-search.js \"search query\"");
  process.exit(0);
}

async function search() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const url = "https://search.yahoo.com/search?p=" + encodeURIComponent(query);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
  await new Promise((r) => setTimeout(r, 2000));

  // Handle consent wall
  if (page.url().includes("consent.yahoo.com")) {
    try {
      const btn = page.locator('button[name="agree"]');
      if (await btn.isVisible({ timeout: 3000 })) {
        await btn.click();
        await new Promise((r) => setTimeout(r, 3000));
      }
    } catch (_) {}

    // If still on consent page, try the form submit
    if (page.url().includes("consent")) {
      try {
        await page.locator('form button[type="submit"]').first().click();
        await new Promise((r) => setTimeout(r, 3000));
      } catch (_) {}
    }
  }

  // Get results text
  const text = await page.evaluate(() => {
    var body = document.body.innerText;
    // Remove common boilerplate
    var lines = body.split("\n").filter(function (l) {
      var t = l.trim();
      if (!t) return false;
      if (t === "Yahoo" || t === "Settings" || t === "Sign In") return false;
      if (t === "Search query" || t === "All" || t === "Images" || t === "Videos" || t === "News" || t === "More" || t === "Anytime") return false;
      if (t.startsWith("Report a concern")) return false;
      if (t.startsWith("Help") && t.length < 10) return false;
      if (t.startsWith("Suggestions") || t.startsWith("Terms") || t.startsWith("Privacy")) return false;
      if (t.startsWith("Advertise") || t.startsWith("About ads") || t.startsWith("About this page")) return false;
      if (t.startsWith("Powered by")) return false;
      return true;
    });
    return lines.join("\n");
  });

  console.log(text);

  await browser.close();
}

search().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
