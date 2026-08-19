#!/usr/bin/env node
/**
 * Google Places API Photo Downloader
 *
 * Usage:
 *   node scripts/places-photos.js "Urban Trim Sheffield" clients/urban-trim-sheffield/site/public/images
 *   node scripts/places-photos.js "Urban Trim Sheffield" clients/urban-trim-sheffield/site/public/images --max=6
 *   node scripts/places-photos.js "Urban Trim Sheffield" clients/urban-trim-sheffield/site/public/images --width=2400
 *
 * Searches for the business via Places API, fetches photo references, and downloads
 * them at up to 2048px wide (override with --width=). No browser automation needed —
 * bypasses Google Maps consent wall entirely.
 *
 * Reported dimensions are always read back off the downloaded file, never copied from
 * the Places listing — see readImageSize() for why that distinction matters.
 *
 * Requires GOOGLE_PLACES_API_KEY in .env file.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

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

// Download ceiling in pixels of width — sized to what a site RENDERS, not to what Google
// holds. The largest element we build is a full-bleed hero at ~1440 CSS px = 2880 device px
// on a 2x screen, so the old hardcoded 1200 was being upscaled 2.4x there: the "mushy hero"
// complaint. Past the render width the extra pixels buy nothing a screen can show, and they
// are not free — sites are `output: 'export'` with `images: { unoptimized: true }`, so every
// byte is served as-is to an owner opening an SMS link on mobile. 2048 is the compromise, at
// a measured ~2x the bytes of 1200, where the API's 4800 ceiling costs ~5x. Raise per-run
// with --width= when a specific hero needs it.
const PHOTO_MAX_WIDTH_DEFAULT = 2048;
const PHOTO_MAX_WIDTH_LIMIT = 4800; // Places API hard maximum for maxWidthPx (4801 → HTTP 400)
// Anything below this is a typo, not an intent: sub-320px files trip the <5KB junk gate below,
// so every photo would "fail" with no stated reason. Treat as invalid and use the default.
const PHOTO_MIN_WIDTH = 320;

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const query = args[0] || "";
const outputDir = args[1] || "";
const maxPhotos = parseInt(process.argv.find((a) => a.startsWith("--max="))?.split("=")[1] || "10");
const widthArg = parseInt(process.argv.find((a) => a.startsWith("--width="))?.split("=")[1] || "", 10);
const maxWidth = Number.isFinite(widthArg) && widthArg >= PHOTO_MIN_WIDTH
  ? Math.min(widthArg, PHOTO_MAX_WIDTH_LIMIT)
  : PHOTO_MAX_WIDTH_DEFAULT;

if (!query || !outputDir) {
  console.log("Google Places API Photo Downloader\n");
  console.log("Usage:");
  console.log('  node scripts/places-photos.js "Business Name Location" OUTPUT_DIR');
  console.log('  node scripts/places-photos.js "Urban Trim Sheffield" clients/urban-trim/site/public/images --max=6');
  console.log('  node scripts/places-photos.js "Urban Trim Sheffield" clients/urban-trim/site/public/images --width=2400');
  console.log(`\nDefaults to 10 photos max, ${PHOTO_MAX_WIDTH_DEFAULT}px wide.`);
  console.log(`--width=N raises or lowers that ceiling (${PHOTO_MIN_WIDTH}-${PHOTO_MAX_WIDTH_LIMIT}); photos smaller than N are left at their native size.`);
  process.exit(0);
}

// Tight-normalise a business name: lowercase, keep letters and digits across
// any script (Unicode \p{L}\p{N}), drop everything else. We deliberately do
// NOT strip corporate-form suffixes (Ltd, GmbH, S.r.l., LLC, Pty, Sp. z o.o.,
// etc.) — that list is unbounded by country and unmaintainable. Brand-vs-
// returned-name matching instead relies on substring overlap of the first
// 1–2 query tokens, which works without a per-country suffix table.
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

function brandAndDescriptor(query) {
  // Unicode-aware tokenisation: split on any non-letter/non-digit so
  // accented characters (ä, é, ñ, ş, ø, etc.) survive intact in tokens.
  const tokens = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const brandTokens = [];
  let descriptor = null;
  for (const t of tokens) {
    if (ARTICLES.has(t)) continue;
    if (NOISE_TOKENS.has(t)) {
      if (!descriptor) descriptor = t;
      break;
    }
    // Cap brand at 2 tokens. Anything past the cap is almost always a
    // corporate suffix (GmbH, Ltd, S.r.l., …), a town name, or extra
    // descriptors — none belong in the brand. Keep scanning past the cap
    // so we still catch a downstream descriptor token if one appears.
    if (brandTokens.length < 2) brandTokens.push(t);
  }
  // If no descriptor was found and we have 2 brand tokens, the second is
  // almost always a town/city in our query convention ("Brand Town" or
  // "Brand Brand Town"). Drop it so a query like "The Mill Bakery
  // Sheffield" produces brand="mill" rather than "millbakery" matching
  // against the returned name "The Mill Bakery" — the trailing brand
  // word is more likely town than brand when no industry descriptor split it.
  if (!descriptor && brandTokens.length >= 2) {
    brandTokens.pop();
  }
  const brand = brandTokens.length ? brandTokens.join("") : tokens.slice(0, 2).join("");
  return { brand, descriptor };
}

function nameMatchesQuery(returnedName, query) {
  const { brand, descriptor } = brandAndDescriptor(query);
  if (!brand || brand.length < 2) return true;
  const tight = normaliseTight(returnedName);
  if (!tight.includes(brand)) return false;
  if (descriptor && !tight.includes(descriptor)) return false;
  return true;
}

async function searchPlace(textQuery) {
  const url = "https://places.googleapis.com/v1/places:searchText";
  // pageSize=5 lets us disambiguate when the API ranks a similarly-named
  // but different business at #1. We then pick the first result whose
  // displayName matches the query brand+descriptor — see main().
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
    "places.photos",
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

// --ssl-no-revoke disables certificate revocation list checks. On Windows
// curl uses Schannel by default, which tries to fetch CRLs to verify the
// cert isn't revoked — that fetch fails behind a corporate proxy /
// TLS-intercepting antivirus, and the whole connection collapses. On
// non-Schannel curl (macOS LibreSSL, Linux OpenSSL) the flag is either
// silently ignored or unsupported, so we only pass it on Windows. Slight
// security downgrade in exchange for the photos actually downloading; the
// alternative for affected buyers is "no photos at all" → no website built.
const SSL_FLAG = process.platform === "win32" ? "--ssl-no-revoke " : "";

// Read the real pixel dimensions back off the downloaded bytes.
//
// We deliberately do NOT report photo.widthPx / photo.heightPx from the Places listing:
// those are the dimensions Google HOLDS, not the ones we asked for and were sent. Printing
// the source size for a file that was never downloaded at that size is how a client's
// gathered-content.md ends up claiming "4601x2685" beside a file that is actually 1200x700
// — and the build step, reading that, confidently drops the photo into a full-bleed band it
// cannot support. The honest number is the one on disk, so that is the one we print.
//
// JPEG and PNG only (all the Photos endpoint has ever returned). Anything else falls back
// to the caller's derived estimate rather than to the source dimensions.
function readImageSize(filepath) {
  let buf;
  try {
    buf = fs.readFileSync(filepath);
  } catch (_) {
    return null;
  }
  // PNG: 8-byte signature, then the IHDR chunk's length+type, then width/height as BE uint32.
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: walk the marker chain to the SOFn frame header, which carries the true frame
  // size (1-byte sample precision, then height then width, both BE uint16).
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) { off++; continue; }              // not a marker start; resync
      const marker = buf[off + 1];
      // 0xFF is a legal fill byte padding a marker, 0x00 a stuffed data byte. Neither is a
      // marker, so step one byte and re-read — treating either as a segment would misread
      // the next two bytes as a length and skip straight past the SOF.
      if (marker === 0xff || marker === 0x00) { off++; continue; }
      // Standalone markers carry no length field: TEM, RSTn, and a repeated SOI.
      if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
        off += 2;
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) break;           // EOI / start of scan data
      const len = buf.readUInt16BE(off + 2);
      // SOF0-SOF15 hold the frame size. C4 (DHT), C8 (JPG ext) and CC (DAC) sit in the
      // same numeric range but are not frame headers.
      if (marker >= 0xc0 && marker <= 0xcf &&
          marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
      }
      if (len < 2) break;                                      // malformed; don't spin
      off += 2 + len;
    }
  }
  return null;
}

async function downloadPhoto(photoName, filepath, srcWidth, srcHeight) {
  // Ask for the render ceiling, but never more than the source actually holds — Google
  // does not upscale, so requesting above srcWidth just returns srcWidth and wastes nothing.
  const want = Math.max(1, Math.min(srcWidth || maxWidth, maxWidth));
  const url = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${want}&key=${API_KEY}`;
  try {
    // curl follows the redirect to the actual image CDN. 45s rather than 20s because these
    // files are ~2x larger than at the old 1200 cap, so a slow operator connection is likelier
    // to hit the ceiling — and a timeout here is worse than a plain failure (see the catch).
    execSync(`curl -L -s ${SSL_FLAG}-o "${filepath}" "${url}"`, { timeout: 45000 });
    const stats = fs.statSync(filepath);
    if (stats.size < 5000) {
      fs.unlinkSync(filepath);
      return null;
    }
    // Measured beats derived; derived beats the source dims we were never sent. The derived
    // fallback is close to exact because maxWidthPx scaling preserves the aspect ratio.
    const measured = readImageSize(filepath);
    return {
      size: stats.size,
      width: measured ? measured.width : want,
      height: measured
        ? measured.height
        : (srcWidth && srcHeight ? Math.round((srcHeight * want) / srcWidth) : 0),
      measured: Boolean(measured),
    };
  } catch (_) {
    // A timeout kills curl mid-write, so the target path can hold a truncated image. Leaving
    // it would be worse than a clean failure: we report "Failed" and omit it from the summary,
    // but the build step copies data/images/* wholesale and is told every downloaded file must
    // appear on the site — so a half-rendered photo would ship to a real business owner.
    try { fs.unlinkSync(filepath); } catch (_) {}
    return null;
  }
}

async function main() {
  console.error(`Searching for "${query}"...`);

  const places = await searchPlace(query);
  if (!places.length) {
    console.log("ERROR: No place found for that search query.");
    process.exit(1);
  }

  // Scan top results, pick the first one whose displayName matches the query
  // brand+descriptor. This avoids false rejections when Google ranks a
  // similarly-named but different business at #1 — the right business is
  // often at #2 or #3.
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
  const photos = place.photos || [];

  console.error(`Found: ${name} — ${address}`);
  console.error(`Photos available: ${photos.length}`);

  if (photos.length === 0) {
    // An empty photos array means no photos on the PLACES listing — not that no image
    // exists: Maps falls back to a Street View exterior as the cover, which this API
    // never returns. An operator seeing that cover would conclude the script is broken,
    // so scope the message precisely and point at the fallback ladder.
    console.log("NO PLACES PHOTOS: this listing has zero contributed photos in the Places API.");
    console.log("Its Google Maps page may still show a cover image — usually a Street View exterior,");
    console.log("which this API cannot return. Try the gather skill's zero-photo fallback ladder.");
    process.exit(0);
  }

  // Create output directory
  fs.mkdirSync(outputDir, { recursive: true });

  const toDownload = photos.slice(0, maxPhotos);

  // Bounded-concurrency pool (Fable consult, 2026-08-19) instead of one CDN download fully
  // awaited before the next starts — up to ~10 sequential downloads per gather. gmapsN.jpg
  // filenames stay deterministic (index-based, not completion-order), and `slots` preserves the
  // original photo order regardless of which download happens to finish first, since downstream
  // code treats gmaps1/gmaps2/... as meaningfully ordered (e.g. hero-image preference).
  const slots = new Array(toDownload.length);
  async function downloadOne(i) {
    const photo = toDownload[i];
    const photoName = photo.name; // e.g. "places/PLACE_ID/photos/PHOTO_REF"
    // Source dimensions, i.e. what Google holds. Kept for reference only — never reported
    // as if they described the downloaded file. See readImageSize().
    const srcW = photo.widthPx || 0;
    const srcH = photo.heightPx || 0;
    const filename = `gmaps${i + 1}.jpg`;
    const filepath = path.join(outputDir, filename);

    const result = await downloadPhoto(photoName, filepath, srcW, srcH);
    if (result) {
      const { size, width: w, height: h } = result;
      // Orientation from the file we actually have. (maxWidthPx preserves aspect ratio, so
      // this agrees with the source — but derive it from the real file anyway, so a single
      // honest set of numbers feeds every downstream layout decision.)
      const orientation = w && h
        ? (h > w ? "portrait" : w > h ? "landscape" : "square")
        : (srcH > srcW ? "portrait" : srcW > srcH ? "landscape" : "square");
      const src = srcW > w ? ` (source ${srcW}x${srcH})` : "";
      // Near-never: only if the endpoint served a format readImageSize can't parse, in which
      // case WxH is derived from the requested width rather than read off the file. Say so
      // rather than let an estimate pass as a measurement — that conflation is this bug.
      const est = result.measured ? "" : " [estimated]";
      slots[i] = {
        file: filename, path: filepath, size: size,
        width: w, height: h, orientation: orientation,
        srcWidth: srcW, srcHeight: srcH, measured: result.measured,
      };
      console.error(`  Downloaded: ${filename} (${Math.round(size / 1024)}KB) ${w}x${h} ${orientation}${src}${est}`);
    } else {
      console.error(`  Failed: ${filename}`);
    }
  }
  const DOWNLOAD_CONCURRENCY = 5;
  let nextPhoto = 0;
  async function downloadWorker() {
    while (nextPhoto < toDownload.length) {
      const i = nextPhoto++;
      await downloadOne(i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, toDownload.length) }, downloadWorker)
  );
  const downloaded = slots.filter(Boolean);

  // Output summary. Orientation matters for layout: most Google photos are
  // portrait 3:4 and belong in portrait containers, never short wide boxes.
  console.log(`\nDownloaded ${downloaded.length}/${toDownload.length} photos to ${outputDir}:\n`);
  for (const d of downloaded) {
    const src = d.srcWidth > d.width ? ` (source ${d.srcWidth}x${d.srcHeight})` : "";
    const est = d.measured ? "" : " [estimated]";
    console.log(`  /images/${d.file} (${Math.round(d.size / 1024)}KB) — ${d.width}x${d.height} ${d.orientation}${src}${est}`);
  }
  console.log('\nDimensions are the files on disk — size layouts against these. A bracketed "(source WxH)" is what Google still holds, not what you have.');

  console.log("\n---JSON---");
  console.log(JSON.stringify({
    business: name,
    address: address,
    totalAvailable: photos.length,
    downloaded: downloaded,
  }, null, 2));
}

main();
