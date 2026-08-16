# Lessons — Finding & Gathering Data

Accumulated lessons for the gather stage (photo sourcing, reviews, contact data, regional sources).

## Region-Specific Sources

Klaudius's `gather` skill ships with a universal core — Google Maps, Yahoo Search, Instagram, Facebook, Apple Maps, Restaurant Guru, Wanderlog, TripAdvisor — that works in every country. Country-specific business directories, review aggregators, and registries are *not* curated by Klaudius (they go stale fast). You accumulate that regional knowledge in the Site Access Status section below as you discover it while running the pipeline. The `gather` skill reads this file at the start of every invocation, so each entry you write becomes operational intelligence for the next run.

## Photos (sourcing & downloading)
- **Instagram CDN URLs expire within hours.** Never hotlink cdninstagram.com URLs. Download to `site/public/images/` and reference as `/images/filename.jpg`. Google Maps and Restaurant Guru URLs are permanent.
- **Google Maps cover photos can be wrong.** If a business has fewer than 3 Google Maps photos, the cover photo may be auto-assigned by Google and show a completely different business (e.g. hair salon photo on a cleaning company).
- **Street View can be unflattering.** Shutters down, vans blocking, wrong building. Take a screenshot and visually verify before including.
- **Restaurant Guru photos have a cartoon watermark.** Use as fallback when no better source exists, but prefer Google Maps or Instagram photos.
- **Agents describe photos instead of extracting URLs.** Writing "Instagram has 25 posts with photos" is useless - the build step needs actual URLs or downloaded files.
- **Verify Instagram downloads before using.** Not every Instagram post is a usable photo. Posts can be closure notices, text announcements, memes, or promotional graphics. After downloading each image, visually verify it with the Read tool. If it's not a real photo of the business or their work, delete it and find another post.
- **Don't use generic Street View as filler.** Random photos of the town centre, car parks, or nearby shops add no value to a business website. Only use Street View if it clearly shows the actual business premises. Better to have fewer photos than irrelevant ones.
- **Size Google Maps photo URLs to `=w2048`.** The suffix on `lh5/lh3.googleusercontent.com` sets the served resolution. Google's default (`=w800-h600-k-no`) is too small and goes pixelated in a full-width hero; `=w0-h0` is the opposite mistake, returning the untouched 3-4MB original into what is usually the hero. Example: `curl -sL "https://lh5.googleusercontent.com/p/XXXXX=w2048" -o photo.jpg`.
- **Facebook photos are low-res without login.** The photos grid on public Facebook profiles only serves thumbnails (max ~851x315). Individual photo pages require login. These are usable but noticeably soft at larger display sizes. Prefer Google Maps or Instagram photos when available; use Facebook photos as a fallback rather than primary images.
- **Use `places-photos.js` for Google Maps photos.** `node scripts/places-photos.js "Business Name Location" OUTPUT_DIR --max=10` searches the Places API, fetches photo references, and downloads them at up to 2048px wide. No browser needed — bypasses the Google Maps consent wall entirely. This is faster and more reliable than any Playwright/Patchright approach.
- **Design against the `WxH` the script prints — that's the file on disk.** A bracketed `(source WxH)` is only what Google still holds, not what you have. If a hero needs more, re-run with `--width=2400` (max 4800).

## Data Gathering
- **Verify the Places API actually returned YOUR business, not a similarly-named one.** `places:searchText` returns results loosely matching the query. With similar local-trade names (e.g. "A.D.S Painter & Decorator" vs "D A Decorating Services" — both painters in the same town, both small local outfits) Google may rank the wrong one at #1. The agent then writes that CID into gathered-content.md, and the build step embeds the wrong Google Maps listing, attributes the wrong reviews, and produces a site about Business X branded as Business Y. The contact mobile sourced separately (e.g. from Facebook) may be correct, but everything Maps-derived is wrong — including the live business the recipient sees when they click the embedded map. The scripts now request the top 5 API results and auto-pick the first one whose `displayName` matches the query's BRAND + INDUSTRY descriptor (token-level substring match against a tight-normalised form). When the right business is at #2 you'll see a `Note: picked result #2 because #1 ("...") did not match` line — proceed normally; that's the disambiguation working. Only when none of the top 5 match does the script exit non-zero with `MISMATCH` — at that point the business almost certainly isn't on Maps under the queried name, and you should skip the candidate rather than retry with a fuzzier query (which will cheerfully return the wrong business and lock you back into the same failure mode).

- **Two-pass contact check before building.** Pass 1: obvious sources. Pass 2: Instagram REST API, Booksy, Fresha, ThreeBestRated, Cylex. If both fail, skip the business.
- **Coverage matters, not volume.** A business with 15 reviews and no Instagram is fine if we capture all 15 reviews. The problem is when a business has 500 reviews and an active Instagram but we only grab 2 reviews and no photos. Don't skip businesses because they have a small online presence - build the best site possible from what exists.
- **Use `places-reviews.js` as the primary review source.** Run `node scripts/places-reviews.js "Business Name Location"` — it returns up to 5 reviews with full text, author name, rating, and date from the Google Places API in one call. This is far more reliable than scraping review aggregator sites (ReviewBritain, CityMaps) which frequently 404 or get Cloudflare-blocked. Use aggregator sites only as a backup if you need more than 5 reviews.
- **Google Maps does NOT show review counts or review text in headless browsers.** Even when signed in, headless Playwright gets Google's "limited view" which hides review counts and review text. Do NOT waste time trying to extract reviews from Google Maps (scrolling review sections, clicking tabs, trying different URLs). Use Google Maps ONLY for: rating (stars), address, phone, hours, photos, and confirming "Add website".

- **Aggregator sub-scores are NOT overall star ratings.** Restaurant Guru, TripAdvisor, and similar aggregators often show per-category sub-scores (Food / Service / Atmosphere / Value) next to reviews that were originally posted on Google. A reviewer can give Food: 5/5 while giving the business a 2-star OVERALL rating on Google — and the review text in that case is often short, narrowly worded, or damning with faint praise ("tasty food" and nothing else). When capturing reviews from aggregators, record the OVERALL star rating only — never treat a category sub-score as overall stars. If the overall rating isn't exposed, skip the review; we burned a lead once by showing a 2-star Google review as 5-star social proof because the aggregator only exposed Food: 5/5. `places-reviews.js` (Google Places API) is the safe primary source — it returns verified overall ratings.

- **Always put the mobile number in the `phone` field.** The `phone` field is used for SMS outreach. If only a landline exists, put it in `phone`. If both exist, put mobile in `phone` and landline in `landline`. Never store a landline in `phone` when a mobile is available - it causes SMS sends to fail.

- **"Unreachable" means NO contact method at all.** A business is only unreachable if there is no email, no mobile phone number, AND no social media presence (Facebook/Instagram). If they have a mobile number, use SMS. If they have Instagram/Facebook but no email or phone, proceed through the full pipeline and mark for manual DM — store the Facebook URL in the `facebook` column and/or Instagram handle in the `instagram` column in Supabase. Keep status as `deployed` (not `outreach_sent`) and add a note like "Manual DM required". Only set `outreach_sent` once the DM is actually sent.

## Playwright-cli Syntax
- **`npx playwright-cli eval` fails on arrow functions, `.map()`, `.forEach()`, spread syntax.** These all throw "not well-serializable" errors. Use old-style `for` loops, string concatenation, and `JSON.stringify()` wrappers instead. Example that WORKS: `npx playwright-cli eval "JSON.stringify(Array.from(document.querySelectorAll('img')).map(function(i) { return i.src }))"`. Example that FAILS: `npx playwright-cli eval "document.querySelectorAll('img').forEach(i => console.log(i.src))"`.

## Site Access Status

(If an old pre-split `prompts/lessons.md` still exists in this project with accumulated entries below these headings, migrate them here and slim that file to its index form.) This section is empty by design — Klaudius doesn't ship pre-curated country-specific findings. As you run the pipeline and discover useful (or useless) directories, review aggregators, and registries in the operator's country, record them below using these categories. Naming a specific site and one line of access notes is enough; future runs lean on what you write.

**Works with Playwright:**
- _(none yet — add entries here as you confirm them)_

**Works with Patchright (anti-detection Playwright fork) but NOT regular Playwright:**
- _(none yet — note the `const { chromium } = require("patchright")` import when you add)_

**Blocked even with Patchright (don't waste time):**
- _(none yet — note the failure mode, e.g. Cloudflare 403, geo-block, login-wall)_

**Dead / unreliable listings:**
- _(none yet — note the 404 rate or shutdown reason)_

---
*Add new lessons for this stage as they arise*
