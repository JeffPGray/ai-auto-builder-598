#!/usr/bin/env node
/**
 * Google Places API Review Fetcher
 *
 * Usage:
 *   node scripts/places-reviews.js "Urban Trim Sheffield"
 *
 * Searches for the business via Places API and returns up to 5 reviews
 * with full text, author name, rating, and date. Also returns the overall
 * rating, total review count, and opening hours.
 *
 * Each review carries BOTH `text` (in OPERATOR_LANGUAGE_CODE, since the API
 * translates to the request's languageCode) AND `originalText` +
 * `originalLanguage` (the review as the customer actually wrote it). Quote the
 * ORIGINAL on the site when its language matches the site language — Google's
 * translation mangles meaning (e.g. "cocina perfecta" / the perfect kitchen
 * came back as "perfect dish"). This honours the gather rule: reviews stay in
 * their source language for authenticity, never back-translated.
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
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  const keyMatch = envContent.match(/^GOOGLE_PLACES_API_KEY=(.+)$/m);
  if (keyMatch) API_KEY = keyMatch[1].trim();
  const regionMatch = envContent.match(/^OPERATOR_COUNTRY_CODE=(.+)$/m);
  if (regionMatch && regionMatch[1].trim()) REGION_CODE = regionMatch[1].trim();
  const langMatch = envContent.match(/^OPERATOR_LANGUAGE_CODE=(.+)$/m);
  if (langMatch && langMatch[1].trim()) LANGUAGE_CODE = langMatch[1].trim();
}

if (!API_KEY) {
  console.error("ERROR: GOOGLE_PLACES_API_KEY not found in .env file");
  process.exit(1);
}

const query = process.argv.slice(2).join(" ");

if (!query) {
  console.log("Google Places API Review Fetcher\n");
  console.log("Usage:");
  console.log('  node scripts/places-reviews.js "Business Name Location"');
  console.log("\nReturns up to 5 reviews with text, rating, author, and date.");
  process.exit(0);
}

// Tight-normalise a business name: lowercase, keep letters and digits across
// any script (Unicode \p{L}\p{N}), drop everything else. We deliberately do
// NOT strip corporate-form suffixes (Ltd, GmbH, S.r.l., LLC, Pty, Sp. z o.o.,
// etc.) — that list is unbounded by country and unmaintainable. Brand-vs-
// returned-name matching instead relies on substring overlap of the first
// 1–2 query tokens, which works without a per-country suffix table.
// Examples (after normalisation):
//   "A.D.S Painter & Decorator" -> "adspainterdecorator"
//   "Wade Interiors"            -> "wadeinteriors"
//   "Schmidt Bäckerei GmbH"     -> "schmidtbäckereigmbh"
function normaliseTight(s) {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

// English industry descriptors. The brand-extraction scan stops at the first
// one it sees, which gives clean brand+industry separation for English
// queries. Queries in other languages (German "Bäckerei", Italian "Pizzeria",
// French "Boulangerie", etc.) won't match anything here — they fall through
// to the 2-token brand cap in brandAndDescriptor, which is country-agnostic.
const NOISE_TOKENS = new Set([
  "painter","painters","decorator","decorators","decorating","plumber","plumbing","heating",
  "electrician","electrical","builder","builders","building","gardener","gardening",
  "landscaping","landscapes","carpenter","carpentry","roofing","roofer","barber","barbers",
  "barbershop","salon","hair","beauty","tattoo","cleaning","cleaners","mechanic","autos","auto",
  "garage","cafe","restaurant","bistro","kitchen","kitchens","bathroom","bathrooms","tiling",
  "tiler","interiors","interior","exterior","property","properties","arboriculture","arborist",
  "tree","trees","surgeon","surgeons",
  "shop","store","studio","centre","center","group","solutions","specialists",
]);

// Common leading articles across major operator-market languages. Skipped so
// a leading "The" / "Le" / "El" / "Der" doesn't waste a brand-token slot.
// Not exhaustive — just enough to handle the common case.
const ARTICLES = new Set([
  "the","a","an",
  "le","la","les","l",
  "el","los","las",
  "il","i","gli","lo",
  "der","die","das","den","dem",
  "de","het",
  "o","os","as",
]);

// Extract the BRAND portion of a query (the strong identity signal) plus an
// optional industry descriptor for a secondary check. For "A.D.S Painter &
// Decorator Norwich" returns brand="ads" / descriptor="painter"; for "Wade
// Interiors Halifax" returns brand="wadeinteriors" / descriptor="interiors".
function brandAndDescriptor(query) {
  // Unicode-aware tokenisation: split on any non-letter/non-digit so accented
  // characters (ä, é, ñ, ş, ø, etc.) survive intact in tokens.
  const tokens = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const brandTokens = [];
  let descriptor = null;
  for (const t of tokens) {
    if (ARTICLES.has(t)) continue;
    if (NOISE_TOKENS.has(t)) {
      if (!descriptor) descriptor = t;
      // Once descriptor seen, we can stop scanning — anything after is more
      // descriptors / town / corporate suffix etc.
      break;
    }
    // Cap brand at 2 tokens. Anything past the cap is almost always a
    // corporate suffix (GmbH, Ltd, S.r.l., …), a town name, or extra
    // descriptors — none belong in the brand. Keep scanning past the cap
    // so we still catch a downstream descriptor token if one appears.
    if (brandTokens.length < 2) brandTokens.push(t);
  }
  // If no industry descriptor was found and we collected 2 brand tokens, the
  // second is almost certainly the town/city (queries are conventionally
  // "Brand Town" or "Brand Brand Town"). Drop it so a query like "The Mill
  // Bakery Sheffield" produces brand="mill" — looser but country-agnostic.
  if (!descriptor && brandTokens.length >= 2) {
    brandTokens.pop();
  }
  // Fallback: if every leading token is an article or descriptor, fall back
  // to first 1–2 raw tokens.
  const brand = brandTokens.length ? brandTokens.join("") : tokens.slice(0, 2).join("");
  return { brand, descriptor };
}

// Two-part match check on the tight-normalised returned name:
//   1. The query's BRAND portion (everything before the first industry/noise
//      descriptor) must appear contiguously inside the returned name. This
//      catches cases like A.D.S → D A Decorating, ElectricCal → Glasgow
//      Electrical Testing, where the brand identity is missing entirely.
//   2. The query's INDUSTRY descriptor (the first noise token, e.g. "garage",
//      "tiling", "carpentry") must ALSO appear in the returned name. This
//      catches "M A Garage Sheffield" → "MA Automotive" (brand "ma" matches
//      but descriptor "garage" is absent) and "Mario Tiling Plymouth" →
//      "Mario BUILDER" (brand matches but "tiling" is absent — different trade).
function nameMatchesQuery(returnedName, query) {
  const { brand, descriptor } = brandAndDescriptor(query);
  if (!brand || brand.length < 2) return true; // can't make a confident check
  const tight = normaliseTight(returnedName);
  if (!tight.includes(brand)) return false;
  if (descriptor && !tight.includes(descriptor)) return false;
  return true;
}

async function searchPlace(textQuery) {
  const url = "https://places.googleapis.com/v1/places:searchText";
  // pageSize=5 (instead of 1) lets us disambiguate when the API ranks a
  // similarly-named but different business at #1. We then pick the first
  // result that actually passes the brand+descriptor name match — see main().
  const body = {
    textQuery: textQuery,
    pageSize: 5,
    regionCode: REGION_CODE,
    languageCode: LANGUAGE_CODE,
  };

  const fieldMask = [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.rating",
    "places.userRatingCount",
    "places.regularOpeningHours",
    "places.reviews",
  ].join(",");

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
    const error = await response.json();
    console.error("API ERROR:", error.error?.message || JSON.stringify(error));
    process.exit(1);
  }

  const data = await response.json();
  return data.places || [];
}

async function main() {
  console.error(`Searching for "${query}"...`);

  const places = await searchPlace(query);
  if (!places.length) {
    console.log("ERROR: No place found for that search query.");
    process.exit(1);
  }

  // Scan the top results and pick the first one whose displayName actually
  // matches the queried business (brand + industry descriptor must both
  // appear in the returned name). Places API ranking is non-deterministic
  // and similarly-named businesses can outrank ours at #1; this disambiguates
  // without losing genuine candidates.
  let place = null;
  let pickedIndex = -1;
  for (let i = 0; i < places.length; i++) {
    const candidateName = places[i].displayName?.text || "";
    if (nameMatchesQuery(candidateName, query)) {
      place = places[i];
      pickedIndex = i;
      break;
    }
  }
  if (!place) {
    const top = places.map((p, i) => `  [#${i + 1}] ${p.displayName?.text || "?"} — ${p.formattedAddress || "?"}`).join("\n");
    console.log(`MISMATCH: queried "${query}" but none of the top ${places.length} Places API results match the brand and industry of the query.`);
    console.log("Top results were:");
    console.log(top);
    console.log("This means the queried business is most likely NOT on Google Maps under this name. Do NOT proceed — find another candidate or drop this lead.");
    process.exit(2);
  }
  if (pickedIndex > 0) {
    console.error(`Note: picked result #${pickedIndex + 1} ("${place.displayName?.text}") because #1 ("${places[0].displayName?.text}") did not match the query brand/descriptor.`);
  }

  const name = place.displayName?.text || "Unknown";
  const address = place.formattedAddress || "";
  const rating = place.rating || null;
  const totalReviews = place.userRatingCount || 0;
  const hours = place.regularOpeningHours?.weekdayDescriptions || [];
  const reviews = place.reviews || [];

  console.error(`Found: ${name} — ${address}`);
  console.error(`Rating: ${rating}/5 (${totalReviews} reviews)`);
  console.error(`Reviews returned: ${reviews.length}`);

  // Human-readable output
  console.log(`${name}`);
  console.log(`${address}`);
  console.log(`Rating: ${rating}/5 (${totalReviews} reviews)\n`);

  if (hours.length) {
    console.log("Opening hours:");
    for (const line of hours) console.log(`   ${line}`);
    console.log("");
  } else {
    console.log("Opening hours: (not published on this listing)\n");
  }

  if (reviews.length === 0) {
    console.log("No review text available from Google Places API.");
  }

  const parsed = [];

  for (let i = 0; i < reviews.length; i++) {
    const r = reviews[i];
    const author = r.authorAttribution?.displayName || "Anonymous";
    const stars = r.rating || 0;
    const timeDesc = r.relativePublishTimeDescription || "";
    const text = r.text?.text || "";
    const originalText = r.originalText?.text || "";
    const originalLanguage = r.originalText?.languageCode || "";
    const publishTime = r.publishTime || "";

    parsed.push({ author, rating: stars, timeDesc, text, originalText, originalLanguage, publishTime });

    console.log(`${i + 1}. ${author} — ${"★".repeat(stars)}${"☆".repeat(5 - stars)} — ${timeDesc}`);
    // `text` is in OPERATOR_LANGUAGE_CODE (the API translated it); `originalText`
    // is the review as written. When they differ a translation happened — show
    // the ORIGINAL first (that's the authentic quote to put on the site) with the
    // translation beneath to aid understanding.
    const differs = originalText && originalText !== text;
    if (differs) {
      console.log(`   [${originalLanguage || "orig"}] "${originalText}"`);
      if (text) console.log(`   (translated: "${text}")\n`);
      else console.log("");
    } else if (text) {
      console.log(`   "${text}"\n`);
    } else {
      console.log(`   (no text)\n`);
    }
  }

  console.log("---JSON---");
  console.log(JSON.stringify({
    business: name,
    address: address,
    rating: rating,
    totalReviews: totalReviews,
    hours: hours,
    reviews: parsed,
  }, null, 2));
}

main();
