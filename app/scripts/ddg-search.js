#!/usr/bin/env node
/**
 * DuckDuckGo HTML lite Search helper.
 *
 * Wraps html.duckduckgo.com/html/ — the no-JS, anti-bot-friendly endpoint
 * that returns plain HTML SERP results suitable for non-browser clients.
 *
 * Usage:
 *   node scripts/ddg-search.js "Business Name location"
 *
 * Output: one block per result with title, URL, and snippet. Ad-vs-organic
 * tagged. Decodes DDG's //duckduckgo.com/l/?uddg= redirect wrappers to
 * the actual target URL. HTML entities (&amp;, &nbsp;, numeric &#NNNN;,
 * hex &#xNNNN;) decoded in titles and snippets.
 *
 * Why this and not Yahoo / Brave / Google: in 2026 every major search
 * engine (including Brave) serves CAPTCHA challenges to Patchright /
 * undetected-Playwright. DDG's html lite endpoint is the exception —
 * it's designed for non-browser clients and returns real results via
 * plain curl. See CLAUDE.md "Known issues with headless browsing" for
 * the wider context.
 *
 * Caveat: DDG rate-limits if you fire multiple queries in quick succession
 * (returns HTTP 202 with a "please retry" placeholder). The script
 * surfaces this as exit code 2 with an explicit fallback message rather
 * than swallowing it.
 *
 * Exit codes:
 *   0  success
 *   1  network error or non-2xx HTTP after redirects
 *   2  DDG rate-limit / anti-bot placeholder detected
 *   3  HTTP 200 but no parseable result blocks (DDG layout changed?)
 */

const https = require("https");
const { URL } = require("url");

const query = process.argv.slice(2).join(" ");
if (!query) {
  console.log("Usage: node scripts/ddg-search.js \"search query\"");
  process.exit(0);
}

// ─── HTTP fetch: redirect-following, UTF-8 stream-decoded, 15s timeout ──
function get(targetUrl, maxRedirects) {
  if (maxRedirects === undefined) maxRedirects = 3;
  return new Promise((resolve, reject) => {
    const req = https.get(
      targetUrl,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
      },
      (res) => {
        // Follow redirects (301/302/307/308) before draining the body so we
        // don't trip on a relocated endpoint. Relative Locations are resolved
        // against the current URL via the URL constructor.
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          maxRedirects > 0
        ) {
          const nextUrl = new URL(res.headers.location, targetUrl).toString();
          res.resume(); // drain so the socket can be released
          get(nextUrl, maxRedirects - 1).then(resolve, reject);
          return;
        }
        // setEncoding hands chunks to Node's StringDecoder, which buffers
        // partial multi-byte UTF-8 sequences across chunk boundaries.
        // Without this, accented characters in business names (è, ñ, ü, etc.)
        // can corrupt to � when the boundary splits a 2-byte sequence.
        res.setEncoding("utf8");
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("timeout after 15s")));
  });
}

// ─── HTML entity decoding ────────────────────────────────────────────────
// Handles the named entities DDG actually emits (amp, lt, gt, quot, apos,
// nbsp) plus numeric entities in both decimal (&#NNNN;) and hex (&#xNNNN;).
// Unknown entities pass through unchanged so they're at least debuggable
// rather than being silently dropped.
const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};
function decodeEntities(s) {
  return s.replace(/&(#?[a-zA-Z0-9]+);/g, (match, ent) => {
    if (ent[0] === "#") {
      const code =
        ent[1] === "x" || ent[1] === "X"
          ? parseInt(ent.slice(2), 16)
          : parseInt(ent.slice(1), 10);
      if (!isFinite(code) || code < 0 || code > 0x10FFFF) return match;
      try {
        return String.fromCodePoint(code);
      } catch (_) {
        return match;
      }
    }
    const named = NAMED_ENTITIES[ent.toLowerCase()];
    return named !== undefined ? named : match;
  });
}

// ─── DDG redirect-wrapper decode ─────────────────────────────────────────
// DDG wraps every organic result URL as
//   //duckduckgo.com/l/?uddg=<URL-ENCODED-TARGET>&rut=...
// Extract and decode the uddg parameter to recover the actual destination.
// Ad URLs are wrapped the same way but point at duckduckgo.com/y.js which
// the downstream classifier recognises as an ad.
function decodeRedirect(href) {
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (!m) return href;
  try {
    return decodeURIComponent(m[1]);
  } catch (_) {
    return href; // malformed %-encoding — return original rather than crash
  }
}

// ─── Text normalization ─────────────────────────────────────────────────
// Strip any inline HTML tags (some DDG titles wrap brand fragments in
// <b>...</b>), decode entities, collapse whitespace, trim.
function cleanText(s) {
  return decodeEntities(s.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Parse DDG html lite SERP ───────────────────────────────────────────
// Two passes for correctness:
//   1) Collect all result__a positions in document order
//   2) For each title i, search for result__snippet inside the window
//      (title[i].end, title[i+1].start) — the snippet belonging to this
//      title is guaranteed to live before the next title begins.
// This avoids the bug where ad rows without snippets cause index
// misalignment between separately-collected title and snippet arrays.
function parseResults(html) {
  const titleRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/;
  const titles = [];
  let m;
  while ((m = titleRe.exec(html)) !== null) {
    titles.push({
      end: titleRe.lastIndex,
      href: m[1],
      inner: m[2],
      index: m.index,
    });
  }
  return titles.map((t, i) => {
    const windowEnd = i + 1 < titles.length ? titles[i + 1].index : html.length;
    const slice = html.slice(t.end, windowEnd);
    const snip = slice.match(snippetRe);
    return {
      url: decodeRedirect(t.href.replace(/^\/\//, "https://")),
      title: cleanText(t.inner),
      snippet: snip ? cleanText(snip[1]) : "",
    };
  });
}

// ─── Anti-bot detection ─────────────────────────────────────────────────
// Tightened to phrases DDG actually emits when blocking: status 202 is the
// primary signal, the regexes are belt-and-braces for unusual cases where
// a 200 still serves a placeholder. Avoids matching "automated queries"
// inside legitimate result snippets.
function looksLikeBlock(res) {
  if (res.status === 202) return true;
  if (/Sorry, we couldn'?t process your request/i.test(res.body)) return true;
  if (/<title>[^<]*(Robot Detection|Robot Check)[^<]*<\/title>/i.test(res.body)) return true;
  return false;
}

// ─── Main ───────────────────────────────────────────────────────────────
(async () => {
  const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
  let res;
  try {
    res = await get(url);
  } catch (e) {
    console.error("DDG fetch failed: " + e.message);
    process.exit(1);
  }

  if (looksLikeBlock(res)) {
    console.error(
      "DDG rate-limited or anti-bot challenge. Wait ~30s and retry, or " +
      "fall back to Google Places + directory-variation curl checks " +
      "(Step 0b in gather/SKILL.md) for this run."
    );
    process.exit(2);
  }

  if (res.status !== 200) {
    console.error("DDG returned HTTP " + res.status);
    process.exit(1);
  }

  const results = parseResults(res.body);
  if (!results.length) {
    console.error(
      "DDG returned 200 but no parseable result blocks. The HTML structure " +
      "may have changed. Raw response: https://html.duckduckgo.com/html/?q=" +
      encodeURIComponent(query)
    );
    process.exit(3);
  }

  console.log("DDG results for: " + query + "\n");
  const limit = Math.min(results.length, 15);
  for (let i = 0; i < limit; i++) {
    const r = results[i];
    const isAd =
      r.url.includes("duckduckgo.com/y.js") ||
      /ad_provider|ad_domain/.test(r.url);
    console.log((isAd ? "[AD]  " : "[ORG] ") + r.title);
    console.log("      " + r.url);
    if (r.snippet) console.log("      " + r.snippet.slice(0, 200));
    console.log();
  }
})();
