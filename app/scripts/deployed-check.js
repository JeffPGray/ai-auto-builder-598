#!/usr/bin/env node
/**
 * Already-built probe — claim-time collision check
 *
 * Usage:
 *   node scripts/deployed-check.js "Business Name" "Town" [own-website-url]
 *
 * Checks whether someone has already built and deployed a site for this
 * business on a free hosting subdomain (vercel.app / pages.dev / netlify.app).
 * A hit means the business has very likely already been pitched — skip it.
 * Pass the candidate's own existing website URL as the third argument (rescue
 * mode) so their own free-hosted site is never counted as a hit.
 *
 * Costs nothing: no API keys, no auth, a handful of plain HTTP requests.
 * Prints ONE line of JSON and never dumps page HTML:
 *   { "verdict": "clear" }
 *   { "verdict": "taken", "url": "https://...", "host": "vercel" }
 *
 * Verdict rules (deliberately conservative — a skip must be confident):
 *   "taken" — a probed subdomain serves a 200 page whose text contains every
 *             significant business-name token (word-boundary matched; a
 *             single-token name must be 4+ chars AND match the full town).
 *             Anything less is NOT taken: a stranger's unrelated project can
 *             own the same slug.
 *   "clear" — everything else, including every error path. Network trouble
 *             must never block a claim (fail-open; a `note` says why).
 *
 * Inherent false negatives, accepted: Vercel truncates slugs over ~35 chars;
 * Cloudflare/Netlify rename on global collisions; a site moved fully to a
 * custom domain is only caught via the still-live subdomain redirect.
 */

const rawName = process.argv[2];
const rawTown = process.argv[3] || "";
const ownSite = process.argv[4] || "";
if (!rawName) {
  console.error('Usage: node scripts/deployed-check.js "Business Name" "Town" [own-website-url]');
  process.exit(1);
}

const OVERALL_DEADLINE_MS = 20000;
const PER_REQUEST_MS = 5000;
const started = Date.now();

// Legal-form suffixes across the operator countries; tokens() also ignores the
// 3+-char ones so they're never required to appear on the probed page.
const SUFFIX_RE = /\b(ltd|limited|llc|inc|co|gmbh|ag|kg|srl|sarl|sas|sl|sa|bv|nv|oy|ab|aps|as)\.?\s*$/i;
const STOPWORDS = new Set([
  "the", "and", "ltd", "limited", "llc", "inc", "company", "services", "service",
  "gmbh", "srl", "sarl", "sas", "aps",
]);

// NFKD handles most diacritics; these letters don't decompose and need a map.
const CHARMAP = { "ß": "ss", "ø": "o", "Ø": "o", "æ": "ae", "Æ": "ae", "œ": "oe", "Œ": "oe", "ł": "l", "Ł": "l", "đ": "d", "Đ": "d", "ð": "d", "Ð": "d", "þ": "th", "Þ": "th" };
const deburr = (s) =>
  s.replace(/[ßøØæÆœŒłŁđĐðÐþÞ]/g, (c) => CHARMAP[c]).normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

function tokens(s) {
  return deburr(s)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

const slugify = (s) => s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function slugVariants(name, town) {
  const clean = deburr(name).toLowerCase().replace(/['’]/g, "");
  const townSlug = slugify(deburr(town).toLowerCase().replace(/['’]/g, ""));
  const seen = new Set();
  const bases = [];
  const add = (s) => {
    const slug = slugify(s);
    if (slug && slug.length >= 3 && !seen.has(slug)) { seen.add(slug); bases.push(slug); }
  };
  // Deployed slugs are usually a SHORTENED name plus town — measured against real
  // pipeline deploys: "A Woman's Touch Lady Painter & Decorator" in Falmouth lives
  // at a-womans-touch-falmouth. So probe short prefixes first, full forms after.
  const dropped = clean.replace(/&/g, " ").replace(SUFFIX_RE, "");
  const words = dropped.split(/[^a-z0-9]+/).filter(Boolean);
  // a prefix ending in a connective ("advanced-plumbing-and") is never a real slug
  const prefix = (n) => {
    const w = words.slice(0, n);
    while (w.length && ["and", "the", "of"].includes(w[w.length - 1])) w.pop();
    return w.join(" ");
  };
  add(prefix(3));
  add(prefix(4));
  add(dropped);
  add(clean.replace(/&/g, " "));
  add(clean.replace(/&/g, " and ").replace(SUFFIX_RE, ""));
  add(clean.replace(/&/g, " and "));
  // Town-suffixed variants first (the pipeline's own convention, e.g.
  // acme-roofing-leeds) — but never double-append when the name ends with the town.
  const withTown = (b) => (townSlug && !b.endsWith(`-${townSlug}`) && b !== townSlug ? `${b}-${townSlug}` : b);
  const variants = [];
  const push = (v) => { if (!variants.includes(v)) variants.push(v); };
  if (townSlug) for (const b of bases) push(withTown(b));
  for (const b of bases) push(b);
  return variants.slice(0, 10);
}

async function probe(url) {
  const out = { status: null, text: null, err: null };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), PER_REQUEST_MS);
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(t);
    out.status = res.status;
    if (res.ok) {
      const html = (await res.text()).slice(0, 300000);
      out.text = deburr(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, " ")).toLowerCase();
    }
  } catch (e) {
    out.err = (e && (e.cause?.code || e.code || e.name || e.message) || "fetch-error").toString().slice(0, 60);
  }
  return out;
}

const emit = (obj) => {
  // write-with-callback, not console.log + exit: Windows pipe writes are async
  // and an immediate exit can truncate stdout before the agent reads it.
  process.stdout.write(JSON.stringify(obj) + "\n", () => process.exit(0));
};

(async () => {
  const nameTokens = tokens(rawName);
  const townTokens = tokens(rawTown);
  if (!nameTokens.length) return emit({ verdict: "clear", note: "name-untokenizable" });
  // a lone <4-char token can never satisfy the verdict rule — skip the network
  if (nameTokens.length === 1 && nameTokens[0].length < 4) return emit({ verdict: "clear", note: "name-too-weak" });

  let ownHost = null;
  try {
    if (ownSite) ownHost = new URL(ownSite).hostname.replace(/^www\./, "");
  } catch { /* unparseable own-site URL — just don't exclude anything */ }

  // tokens are [a-z0-9]+ so no regex escaping needed
  const wordRe = (t) => new RegExp(`\\b${t}\\b`);
  const nameRes = nameTokens.map(wordRe);
  const townRes = townTokens.map(wordRe);

  const hosts = [
    ["vercel", "vercel.app"],
    ["cloudflare", "pages.dev"],
    ["netlify", "netlify.app"],
  ];

  let attempted = 0;
  let failed = 0;
  for (const slug of slugVariants(rawName, rawTown)) {
    for (const [host, domain] of hosts) {
      if (Date.now() - started > OVERALL_DEADLINE_MS) {
        return emit({ verdict: "clear", note: "deadline-hit" });
      }
      const url = `https://${slug}.${domain}`;
      if (ownHost && `${slug}.${domain}` === ownHost) continue; // the business's own site
      attempted++;
      const res = await probe(url);
      if (res.err) { failed++; continue; }
      if (!res.text) continue; // untaken (404) or unverifiable (401/…) — not a confident hit
      const matched = nameRes.filter((re) => re.test(res.text)).length;
      const townHit = townRes.length > 0 && townRes.every((re) => re.test(res.text));
      // Confident = every name token on the page, OR all-but-one plus the full town
      // (sites often drop one word of the official name). The partial branch only
      // exists for 3+-token names, and its >=2 must come from NON-town tokens:
      // otherwise "Bath Bathroom Fitters"/Bath matches any bathroom page (the town
      // word double-counts), and common-word towns (Reading, Sale, Deal) satisfy
      // townHit in ordinary prose. A single-token name on a global namespace
      // demands a meaty token AND the town.
      const townSet = new Set(townTokens);
      const nonTownMatched = nameTokens.filter((t, i) => !townSet.has(t) && nameRes[i].test(res.text)).length;
      const confident =
        nameTokens.length >= 2
          ? matched === nameTokens.length ||
            (matched >= nameTokens.length - 1 && nonTownMatched >= 2 && townHit)
          : matched === 1 && nameTokens[0].length >= 4 && townHit;
      if (confident) return emit({ verdict: "taken", url, host });
    }
  }
  if (attempted > 0 && failed === attempted) {
    return emit({ verdict: "clear", note: "probe-failed" });
  }
  return emit({ verdict: "clear" });
})().catch(() => { try { emit({ verdict: "clear", note: "crash" }); } catch { process.exit(0); } });
