#!/usr/bin/env node
/**
 * Local-press discovery helper (Stage 1 of the press/story sweep).
 *
 * Usage:
 *   node scripts/news-search.js "Business Name" [town]
 *
 * Queries the Google News RSS search feed for `"Business Name" town` in the
 * operator's language/region (OPERATOR_LANGUAGE_CODE / OPERATOR_COUNTRY_CODE
 * from .env, fallback en/GB) and prints title / outlet / date per item —
 * NOTHING ELSE.
 *
 * The RSS <link> URLs are DELIBERATELY DISCARDED: they are encoded
 * news.google.com redirects that return a JavaScript shell to any
 * non-browser client (Google broke programmatic decoding in 2024), so
 * fetching them silently gets nothing. Stage 2 — finding the real article —
 * is a separate step: search the VERBATIM headline (original script, never
 * translated or simplified) with `node scripts/ddg-search.js "<headline>"`;
 * the publisher's URL comes back as the top hit.
 *
 * An empty result is NORMAL (most small businesses have no press) — it
 * prints NO_PRESS_RESULTS with fallback suggestions and exits 0. The feed
 * also does not strictly honour the quoted phrase, so expect tangential
 * hits: titles are leads to verify, never facts to use.
 *
 * Always exits 0: this is a best-effort discovery step against an
 * undocumented endpoint, and an unavailable feed means the same thing
 * downstream as an empty one (use the fallback, move on). A non-zero exit
 * would read as a failure worth alerting on, which it never is.
 *
 * Pure node, no deps, no keys, explicit UTF-8 — must stay Windows-clean.
 */
"use strict";

const fs = require("fs");
const path = require("path");

// Region/language from .env (same pattern as places-reviews.js).
const envPath = path.join(__dirname, "..", ".env");
let COUNTRY = "GB";
let LANG = "en";
if (fs.existsSync(envPath)) {
  const env = fs.readFileSync(envPath, "utf8");
  const c = env.match(/^OPERATOR_COUNTRY_CODE=(.+)$/m);
  if (c && c[1].trim()) COUNTRY = c[1].trim();
  const l = env.match(/^OPERATOR_LANGUAGE_CODE=(.+)$/m);
  if (l && l[1].trim()) LANG = l[1].trim();
}

const name = process.argv[2];
const town = process.argv.slice(3).join(" "); // multi-word towns work unquoted
if (!name) {
  console.log('Usage: node scripts/news-search.js "Business Name" [town]');
  process.exit(0);
}

const MAX_ITEMS = 12;

function codePoint(m, n) {
  return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m; // no throw on malformed entities
}

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => codePoint(m, parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => codePoint(m, parseInt(d, 10)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, " ")
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(m[1]) : "";
}

function fallbackNote() {
  console.log("NO_PRESS_RESULTS");
  console.log("Empty is normal for small businesses. Optional fallback (1-2 queries max):");
  console.log(`  node scripts/ddg-search.js "\\"${name}\\" ${town} interview"   (use local-language press terms: interview / anniversary / jubileum / krant / etc.)`);
}

async function main() {
  const q = `"${name}"${town ? " " + town : ""}`;
  const url =
    "https://news.google.com/rss/search?q=" + encodeURIComponent(q) +
    `&hl=${encodeURIComponent(LANG)}&gl=${encodeURIComponent(COUNTRY)}` +
    `&ceid=${encodeURIComponent(COUNTRY)}:${encodeURIComponent(LANG)}`;

  let xml;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/rss+xml, application/xml, text/xml",
      },
    });
    clearTimeout(t);
    if (res.status !== 200) {
      console.error(`Google News RSS returned HTTP ${res.status} — treat as unavailable, use the fallback below.`);
      fallbackNote();
      process.exit(0);
    }
    xml = await res.text();
  } catch (e) {
    console.error(`Fetch failed (${e && e.message ? e.message : e}) — treat as unavailable, use the fallback below.`);
    fallbackNote();
    process.exit(0);
  }

  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  if (items.length === 0) {
    fallbackNote();
    process.exit(0);
  }

  console.log(`Press discovery for ${q} (${COUNTRY}:${LANG}) — ${Math.min(items.length, MAX_ITEMS)} of ${items.length} item(s):`);
  console.log("");
  items.slice(0, MAX_ITEMS).forEach((block, i) => {
    const title = tag(block, "title");
    const outlet = tag(block, "source");
    const pub = tag(block, "pubDate");
    let date = "";
    if (pub) {
      const d = new Date(pub);
      date = isNaN(d.getTime()) ? pub : d.toISOString().slice(0, 10);
    }
    console.log(`${i + 1}. ${title}`);
    console.log(`   outlet: ${outlet || "unknown"}${date ? "   date: " + date : ""}`);
  });
  console.log("");
  console.log("Article links are deliberately not shown (Google's RSS links are dead ends for scripts).");
  console.log('To read one: node scripts/ddg-search.js "<the VERBATIM headline above>" — publisher URL is usually hit #1.');
  console.log("Titles are leads, not facts: verify with the two-anchor rule before using anything.");
}

main();
