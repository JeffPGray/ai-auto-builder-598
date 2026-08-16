#!/usr/bin/env node
/**
 * invoice-pdf.js — render an HTML invoice to an A4 PDF.
 *
 * Usage:
 *   node scripts/invoice-pdf.js <input.html> <output.pdf>
 *
 * Used by the /send-invoice skill: the agent writes a bespoke invoice as a
 * self-contained HTML file, and this script prints it to PDF through the
 * Chromium that ships with the repo's playwright dependency (the same engine
 * the pipeline's browser automation already uses — no new install).
 *
 * The PDF is rendered with ZERO page margins: the HTML owns its own margins
 * via body padding / @page rules, which keeps full design control in the
 * document. The HTML must be self-contained — system font stacks and data:
 * URIs only, no webfonts, no network assets (the render is a local file:
 * load and anything remote would hang or silently drop).
 *
 * Exit codes: 0 = PDF written, 1 = render failed, 2 = bad arguments/input.
 *
 * Pure node + the repo's own playwright dep, explicit UTF-8, no shell
 * pipelines — must stay Windows-clean.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

// Windows stdout on a pipe is async — write-with-callback before exiting so
// the final line can't be lost (same rule as deployed-check.js).
function exitWith(code, message, stream) {
  (stream || process.stdout).write(message + "\n", () => process.exit(code));
}

async function main() {
  const htmlArg = process.argv[2];
  const pdfArg = process.argv[3];
  if (!htmlArg || !pdfArg) {
    return exitWith(2, "Usage: node scripts/invoice-pdf.js <input.html> <output.pdf>", process.stderr);
  }

  const htmlPath = path.resolve(htmlArg);
  const pdfPath = path.resolve(pdfArg);
  if (!fs.existsSync(htmlPath)) {
    return exitWith(2, `ERROR: input HTML not found: ${htmlPath}`, process.stderr);
  }

  // playwright is a root dependency; patchright (its undetected fork, also a
  // root dependency) bundles the same API and is a serviceable fallback if
  // playwright's package is ever missing from an install. Resolution is tried
  // from this script's location first (the normal install layout), then from
  // the invoking directory (covers the script being run via an absolute path
  // from outside the project tree).
  const { createRequire } = require("module");
  const requirers = [require, createRequire(path.join(process.cwd(), "package.json"))];
  let chromium = null;
  for (const req of requirers) {
    for (const pkg of ["playwright", "patchright"]) {
      if (!chromium) {
        try {
          ({ chromium } = req(pkg));
        } catch (e) {
          /* try the next candidate */
        }
      }
    }
  }
  if (!chromium) {
    return exitWith(
      1,
      "ERROR: neither playwright nor patchright could be loaded. Run `npm install` " +
        "in the project root, then retry.",
      process.stderr
    );
  }

  let browser;
  try {
    browser = await chromium.launch();
  } catch (e) {
    return exitWith(
      1,
      "ERROR: could not launch Chromium: " +
        (e && e.message ? e.message.split("\n")[0] : String(e)) +
        "\nIf the browser engine is missing, run `npx playwright install chromium` " +
        "(or `npx patchright install chromium` if patchright is the loaded engine) and retry.",
      process.stderr
    );
  }

  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle", timeout: 30000 });
    fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
  } catch (e) {
    try {
      await browser.close();
    } catch (_) {}
    return exitWith(
      1,
      "ERROR: PDF render failed: " + (e && e.message ? e.message.split("\n")[0] : String(e)),
      process.stderr
    );
  }
  try {
    await browser.close();
  } catch (_) {
    // The PDF is already on disk — a noisy close must not fail the render.
  }

  const stat = fs.statSync(pdfPath);
  if (stat.size < 1024) {
    return exitWith(1, `ERROR: PDF looks empty (${stat.size} bytes) — check the HTML renders standalone.`, process.stderr);
  }
  exitWith(0, `PDF written: ${pdfPath} (${stat.size} bytes)`);
}

main().catch((e) => {
  exitWith(1, "ERROR: " + (e && e.message ? e.message : String(e)), process.stderr);
});
