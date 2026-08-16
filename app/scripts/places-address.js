#!/usr/bin/env node
/**
 * places-address.js — one-shot address lookup for a known business.
 *
 * Usage:
 *   node scripts/places-address.js "Cleveland Plumbing Guisborough"
 *
 * Used by /send-invoice when the pipeline has no street address on file for
 * a client (the bill-to address is required content on UK/EU invoices).
 * Deliberately separate from places-search.js: that script filters results
 * by website status for lead sourcing, which hides exactly the businesses
 * this one needs to find (an invoiced client's listing links their new site).
 *
 * Prints up to 5 matches as `name | formattedAddress` — the caller verifies
 * the name matches the client before using an address, and a town-only
 * address (service-area businesses hide their street) means "still ask".
 *
 * Requires GOOGLE_PLACES_API_KEY in .env.
 * Pure node, no deps, explicit UTF-8 reads, no shell pipelines — must stay
 * Windows-clean.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env");
let API_KEY = "";
let REGION_CODE = "";
let LANGUAGE_CODE = "en";
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  const keyMatch = envContent.match(/^GOOGLE_PLACES_API_KEY=(.+)$/m);
  if (keyMatch) API_KEY = keyMatch[1].trim();
  const regionMatch = envContent.match(/^OPERATOR_COUNTRY_CODE=(.+)$/m);
  if (regionMatch && regionMatch[1].trim()) {
    REGION_CODE = regionMatch[1].trim().toUpperCase();
    if (REGION_CODE === "UK") REGION_CODE = "GB";
  }
  const langMatch = envContent.match(/^OPERATOR_LANGUAGE_CODE=(.+)$/m);
  if (langMatch && langMatch[1].trim()) LANGUAGE_CODE = langMatch[1].trim();
}

if (!API_KEY) {
  console.error("ERROR: GOOGLE_PLACES_API_KEY not found in .env file");
  process.exit(1);
}

const query = process.argv.slice(2).join(" ").trim();
if (!query) {
  console.error('Usage: node scripts/places-address.js "<business name> <town>"');
  process.exit(2);
}

async function main() {
  const body = { textQuery: query, pageSize: 5, languageCode: LANGUAGE_CODE };
  if (REGION_CODE) body.regionCode = REGION_CODE;

  const resp = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.businessStatus",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`ERROR: Places API returned HTTP ${resp.status}: ${text.slice(0, 300)}`);
    process.exit(1);
  }

  const data = await resp.json();
  const places = data.places || [];
  if (places.length === 0) {
    console.log("No results found.");
    return;
  }
  for (const p of places) {
    const name = (p.displayName && p.displayName.text) || "Unknown";
    const address = p.formattedAddress || "(no address published)";
    const closed = p.businessStatus && p.businessStatus !== "OPERATIONAL" ? " [CLOSED]" : "";
    console.log(`${name} | ${address}${closed}`);
  }
}

main().catch((e) => {
  console.error("ERROR: " + (e && e.message ? e.message : String(e)));
  process.exit(1);
});
