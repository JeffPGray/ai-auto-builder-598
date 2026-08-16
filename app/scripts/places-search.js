#!/usr/bin/env node
/**
 * Google Places API Search — Find businesses without websites
 *
 * Usage:
 *   node scripts/places-search.js "plumber Enfield London"
 *   node scripts/places-search.js "barber Walthamstow" --min-reviews 20
 *
 * Uses the Google Maps Places API (New) Text Search endpoint.
 * No browser automation needed. No rate limiting. Structured JSON.
 *
 * Requires GOOGLE_PLACES_API_KEY in .env file.
 */

const fs = require("fs");
const path = require("path");

// Load API key + operator region/language from .env
const envPath = path.join(__dirname, "..", ".env");
let API_KEY = "";
let REGION_CODE = "GB";   // Fallback when OPERATOR_COUNTRY_CODE isn't set in .env. Preserves
let LANGUAGE_CODE = "en"; // pre-multi-region behaviour so existing installs keep working.
let REGION_EXPLICIT = false; // country FILTER only applies when the operator actually set a code
let SURFACE_HAS_WEBSITE = false; // PIPELINE_MODES contains "rescue" and/or "booking" — both gate has-website results (site-check.js / booking-check.js)
let MAX_PAGES = 2;        // pages per query (20 results each); override with PLACES_MAX_PAGES=1..3
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  const keyMatch = envContent.match(/^GOOGLE_PLACES_API_KEY=(.+)$/m);
  if (keyMatch) API_KEY = keyMatch[1].trim();
  const regionMatch = envContent.match(/^OPERATOR_COUNTRY_CODE=(.+)$/m);
  if (regionMatch && regionMatch[1].trim()) {
    REGION_CODE = regionMatch[1].trim().toUpperCase();
    if (REGION_CODE === "UK") REGION_CODE = "GB"; // common hand-edit; Google accepts UK as a bias but the ISO code is GB
    REGION_EXPLICIT = true;
  }
  const langMatch = envContent.match(/^OPERATOR_LANGUAGE_CODE=(.+)$/m);
  if (langMatch && langMatch[1].trim()) LANGUAGE_CODE = langMatch[1].trim();
  const modesMatch = envContent.match(/^PIPELINE_MODES=(.+)$/m);
  if (modesMatch && /(^|,)\s*(rescue|booking)\s*(,|$)/i.test(modesMatch[1])) SURFACE_HAS_WEBSITE = true;
  const pagesMatch = envContent.match(/^PLACES_MAX_PAGES=(.+)$/m);
  if (pagesMatch) {
    const n = parseInt(pagesMatch[1].trim(), 10);
    if (n >= 1 && n <= 3) MAX_PAGES = n;
  }
}

if (!API_KEY) {
  console.error("ERROR: GOOGLE_PLACES_API_KEY not found in .env file");
  console.error("Add it to ./.env");
  process.exit(1);
}

// Accept both --min-reviews=20 and --min-reviews 20 (the space form used to be
// silently ignored AND leak the number into the query string).
const rawArgs = process.argv.slice(2);
let minReviews = 0;
const queryParts = [];
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a.startsWith("--min-reviews=")) minReviews = parseInt(a.split("=")[1], 10) || 0;
  else if (a === "--min-reviews") minReviews = parseInt(rawArgs[++i], 10) || 0;
  else if (!a.startsWith("--")) queryParts.push(a);
}
const query = queryParts.join(" ");

if (!query) {
  console.log("Google Places API Search\n");
  console.log("Usage:");
  console.log('  node scripts/places-search.js "plumber Enfield London"');
  console.log('  node scripts/places-search.js "barber Walthamstow" --min-reviews=20');
  process.exit(0);
}

// No-website businesses rank LOW on relevance, so the deeper pages are where they live.
// Each page is a separately billed request — MAX_PAGES (default 2, PLACES_MAX_PAGES to change)
// balances depth against Places API spend.

async function search(textQuery) {
  const url = "https://places.googleapis.com/v1/places:searchText";

  const fieldMask = [
    "nextPageToken",
    "places.displayName",
    "places.formattedAddress",
    "places.addressComponents",
    "places.websiteUri",
    "places.rating",
    "places.userRatingCount",
    "places.nationalPhoneNumber",
    "places.businessStatus",
    "places.googleMapsUri",
  ].join(",");

  const all = [];
  let pageToken = null;
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = {
      textQuery: textQuery,
      pageSize: 20,
      regionCode: REGION_CODE,
      languageCode: LANGUAGE_CODE,
    };
    if (pageToken) body.pageToken = pageToken;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": API_KEY,
        "X-Goog-FieldMask": fieldMask,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (page > 0) {
        // A quota trip or transient failure mid-pagination must not masquerade as a thin town.
        console.error(`WARNING: page ${page + 1} failed (HTTP ${response.status} ${error.error?.status || ""}) — results truncated at ${all.length}`);
        truncated = true;
        break;
      }
      console.error("API ERROR:", error.error?.message || JSON.stringify(error));
      process.exit(1);
    }

    const data = await response.json();
    all.push(...(data.places || []));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return { places: all, truncated };
}

async function main() {
  console.log(`Searching: "${query}"\n`);

  const { places, truncated } = await search(query);

  if (places.length === 0) {
    console.log("No results found.");
    process.exit(0);
  }

  // Country filter. regionCode above is only a BIAS — broad queries (e.g. a bare
  // state/country name) match the region word against business NAMES and can return
  // results from other countries entirely. Country-level only; applied only when the
  // operator explicitly set OPERATOR_COUNTRY_CODE (the GB fallback must stay a bias,
  // not a filter); fail-open per-place when the component is missing, and fail-open
  // entirely if it would wipe out EVERY result (wrong/territory code — e.g. a GB
  // operator working the Isle of Man) — a silent 100% drop reads as "town exhausted".
  let kept = places;
  let outOfRegion = 0;
  if (REGION_EXPLICIT) {
    const inRegion = (p) => {
      const country = (p.addressComponents || []).find((c) => (c.types || []).includes("country"));
      return !(country && country.shortText) || country.shortText.toUpperCase() === REGION_CODE;
    };
    const filtered = places.filter(inRegion);
    if (filtered.length === 0) {
      console.error(`WARNING: all ${places.length} results are outside ${REGION_CODE} — keeping them anyway. Check OPERATOR_COUNTRY_CODE in .env against the region you're searching.`);
    } else {
      outOfRegion = places.length - filtered.length;
      kept = filtered;
    }
  }

  // Separate into has-website and no-website
  const noWebsite = [];
  const socialMediaWebsite = [];
  const hasWebsite = [];
  let notOperational = 0;

  const socialMediaPattern = /\b(instagram\.com|facebook\.com|fb\.com|tiktok\.com|linktr\.ee)\b/i;

  for (const p of kept) {
    // "Is genuinely active" is a hard target criterion — drop closed businesses here
    // rather than exposing a status field nothing downstream reads.
    if (p.businessStatus && p.businessStatus !== "OPERATIONAL") {
      notOperational++;
      continue;
    }
    const name = p.displayName?.text || "Unknown";
    const address = p.formattedAddress || "";
    const rating = p.rating || 0;
    const reviews = p.userRatingCount || 0;
    const phone = p.nationalPhoneNumber || "";
    const website = p.websiteUri || "";
    const status = p.businessStatus || "";
    const mapsUrl = p.googleMapsUri || "";

    // Extract CID for exact Google Maps embed
    const cidMatch = mapsUrl.match(/cid=(\d+)/);
    const cid = cidMatch ? cidMatch[1] : "";
    const mapsEmbed = cid ? `https://www.google.com/maps?cid=${cid}&output=embed` : "";

    const isSocialMedia = website && socialMediaPattern.test(website);
    const entry = { name, address, rating, reviews, phone, website, status, mapsUrl, cid, mapsEmbed, isSocialMedia };

    if (!website) {
      noWebsite.push(entry);
    } else if (isSocialMedia) {
      socialMediaWebsite.push(entry);
    } else {
      hasWebsite.push(entry);
    }
  }

  // Filter by minimum reviews if specified
  const filtered = minReviews > 0
    ? noWebsite.filter((b) => b.reviews >= minReviews)
    : noWebsite;

  // Print results
  const notes = [];
  if (outOfRegion > 0) notes.push(`${outOfRegion} outside ${REGION_CODE} dropped`);
  if (notOperational > 0) notes.push(`${notOperational} closed dropped`);
  if (truncated) notes.push(`INCOMPLETE — pagination failed, treat counts as a lower bound`);
  const dropNote = notes.length ? `, ${notes.join(", ")}` : "";
  console.log(`Found ${places.length} businesses (${noWebsite.length} without website, ${socialMediaWebsite.length} social-media-only, ${hasWebsite.length} with website${dropNote}).\n`);

  const PRINT_CAP = 20;
  if (filtered.length > 0) {
    console.log("=== NO WEBSITE (sorted by reviews) ===\n");
    const sorted = filtered.sort((a, b) => b.reviews - a.reviews);
    sorted.slice(0, PRINT_CAP).forEach((b) => {
      console.log(
        `${b.name} | ${b.rating}★ (${b.reviews} reviews) | ${b.phone || "no phone"} | ${b.address}`
      );
    });
    if (sorted.length > PRINT_CAP) console.log(`  …and ${sorted.length - PRINT_CAP} more with fewer reviews`);
  } else if (noWebsite.length > 0 && minReviews > 0) {
    console.log(`No businesses without website have ${minReviews}+ reviews. Top no-website results:`);
    const sorted = noWebsite.sort((a, b) => b.reviews - a.reviews);
    sorted.slice(0, PRINT_CAP).forEach((b) => {
      console.log(`${b.name} | ${b.rating}★ (${b.reviews} reviews) | ${b.phone || "no phone"} | ${b.address}`);
    });
    if (sorted.length > PRINT_CAP) console.log(`  …and ${sorted.length - PRINT_CAP} more with fewer reviews`);
  } else {
    console.log("All businesses in this search have websites.");
  }

  if (socialMediaWebsite.length > 0) {
    console.log(`\n=== SOCIAL MEDIA ONLY — no real website (${socialMediaWebsite.length}) ===\n`);
    const sortedSm = socialMediaWebsite.sort((a, b) => b.reviews - a.reviews);
    sortedSm.slice(0, PRINT_CAP).forEach((b) => {
      const phoneType = b.phone.startsWith("07") ? "mobile" : b.phone.startsWith("0") ? "landline" : "";
      console.log(
        `${b.name} | ${b.rating}★ (${b.reviews} reviews) | ${b.phone || "no phone"} ${phoneType} | ${b.website} | ${b.address}`
      );
    });
    if (sortedSm.length > PRINT_CAP) console.log(`  …and ${sortedSm.length - PRINT_CAP} more with fewer reviews`);
  }

  // Rescue/booking modes: surface has-website results so /find can gate them
  // (rescue via site-check.js, booking via booking-check.js). Off by default —
  // classic-only installs see identical output to before.
  const gatedCandidates = SURFACE_HAS_WEBSITE
    ? (minReviews > 0 ? hasWebsite.filter((b) => b.reviews >= minReviews) : hasWebsite)
    : [];
  if (gatedCandidates.length > 0) {
    console.log(`\n=== HAS WEBSITE — gate each via booking-check.js (booking mode) / site-check.js (rescue mode) (${gatedCandidates.length}) ===\n`);
    const sortedRc = gatedCandidates.sort((a, b) => b.reviews - a.reviews);
    sortedRc.slice(0, PRINT_CAP).forEach((b) => {
      console.log(
        `${b.name} | ${b.rating}★ (${b.reviews} reviews) | ${b.phone || "no phone"} | ${b.website} | ${b.address}`
      );
    });
    if (sortedRc.length > PRINT_CAP) console.log(`  …and ${sortedRc.length - PRINT_CAP} more with fewer reviews`);
  }

  // JSON output for programmatic use. Kept lean deliberately: with pagination this
  // script can see 60 results/query across 25+ queries per town — dumping everything
  // floods the calling agent's context. Only plausibly-claimable candidates (5+
  // reviews) make the JSON, capped per list; the human-readable sections above still
  // show the full picture.
  const JSON_CAP = 15;
  const lean = (arr) => {
    const eligible = arr.filter((b) => b.reviews >= 5).sort((a, b) => b.reviews - a.reviews);
    const rows = eligible.slice(0, JSON_CAP).map(({ isSocialMedia, status, mapsUrl, ...keep }) => keep);
    // omitted = eligible rows beyond the cap only; sub-5-review listings aren't leads and aren't counted
    return { rows, omitted: eligible.length - rows.length };
  };
  const nw = lean(noWebsite);
  const sm = lean(socialMediaWebsite);
  const rc = lean(gatedCandidates);
  console.log("\n---JSON---");
  console.log(
    JSON.stringify(
      {
        query: query,
        total: places.length,
        truncated: truncated,
        outOfRegionDropped: outOfRegion,
        closedDropped: notOperational,
        noWebsite: nw.rows,
        noWebsiteOmitted: nw.omitted,
        socialMediaWebsite: sm.rows,
        socialMediaOmitted: sm.omitted,
        ...(SURFACE_HAS_WEBSITE ? { hasWebsite: rc.rows, hasWebsiteOmitted: rc.omitted } : {}),
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
