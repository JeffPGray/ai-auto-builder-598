---
name: auto-updating-google-rating
description: Retrofit a deployed client site with a live, auto-updating Google rating + review-count badge straight from Google Places — the number refreshes itself, no redeploy, no monthly widget. Vercel only.
argument-hint: [business-name]
effort: medium
allowed-tools: Bash(npx *), Bash(npm *), Bash(node *), Bash(bash *), Bash(python3 *), Bash(cd *), Bash(cp *), Bash(mv *), Bash(mkdir *), Bash(rm *), Bash(cat *), Bash(grep *), Bash(test *), Bash(curl *), Bash(printf *), Bash(sleep *), Bash(kill *), Bash(pkill *), Bash(head *), Bash(cut *), Bash(tr *), Bash(echo *), Read, Write, Edit, Glob, Grep
---

# Add a live Google rating to $ARGUMENTS

Read `prompts/lessons/build.md` and `prompts/lessons/deploy.md` before starting — this skill rebuilds and redeploys the client site, and those failure modes apply.

Retrofit the already-deployed site in `clients/$ARGUMENTS/site` with a **live Google rating**: the star rating and review count are fetched from Google Places at render time and cached for 7 days, so the number on the site keeps itself current as new reviews land — with no redeploy, no third-party widget, and no monthly fee. The owner pays a review widget $5–19/month for exactly this; here it's baked into the site they own.

The runtime helper is copied verbatim from `.claude/skills/auto-updating-google-rating/reference/`; only the Place ID and where the number renders are site-specific. Do not redesign it.

## Architecture (read once, then follow the steps)

- `src/lib/places-stats.ts` — server-only helper (`getPlaceStats(placeId)`) that calls the Google Places API with a 7-day ISR cache and returns `{ rating, count }`, or `null` on any failure. Copied verbatim. The key (`GOOGLE_PLACES_API_KEY`) is server-only — it never reaches the browser, so there is **no API route and no client fetch**.
- The page renders the live number wherever it already shows social proof, via a server component. No client JS.
- This needs the site to render **server-side** so ISR can refresh the value. A default Klaudius site is a static export (`output: 'export'`), which bakes the number in at build time and never refreshes it — so Step 2 flips the runtime, exactly like `/cms` does. That's why this skill is **Vercel only** for now.

## Step 0 — Preconditions (STOP gates)

1. **Host must be Vercel.** `grep -E '^DEPLOY_PROVIDER=' .env | head -1 | cut -d= -f2- | tr -d '"'` — if it says `cloudflare` or `netlify`, **STOP** and tell the operator: the live refresh needs server-side rendering with ISR, which the static export path on those hosts can't do. (A static build can still bake the number in once, but it won't auto-update — which defeats the feature.) No partial install.
2. **The site must exist and be deployed.** `test -d clients/$ARGUMENTS/site` and a `deployed_url` in Supabase (`python3 scripts/db.py client $ARGUMENTS`) or `clients/$ARGUMENTS/data/status.md`. If built but not deployed, run `/deploy $ARGUMENTS` first.
3. **Not already installed.** If `clients/$ARGUMENTS/data/google-rating.md` exists, this is already done — switch to § Maintenance and ask what the operator wants changed.
4. **The Places key must be set.** `grep -E '^GOOGLE_PLACES_API_KEY=' .env` must return a real value (it's a pipeline prerequisite — `gather` uses it). It must also be present on the Vercel project; Step 5 checks and sets it. If the operator never configured a Places key, STOP and have them run `npx klaudius configure`.
5. **Note the Next/React versions** from `clients/$ARGUMENTS/site/package.json` — only relevant if the site is a static export you're flipping (Step 2).
6. **If the site already has a CMS** (`clients/$ARGUMENTS/data/cms.md` exists): the page is already `export const dynamic = "force-dynamic"` with content served from Vercel Blob. Two adjustments — (a) `force-dynamic` makes fetches run uncached on every request, which **overrides** the helper's 7-day `revalidate` — so wrap the call as `unstable_cache(() => getPlaceStats(PLACE_ID), ['google-rating'], { revalidate: 604800 })` to keep it from hitting Google on every page view, and skip the page-level `export const revalidate` (it's moot under `force-dynamic`); and (b) drive the rating from `getPlaceStats` and keep it OUT of the CMS-editable fields, or the live value and the owner's saved edit will overwrite each other. If the rating is currently an editable CMS field, ask the operator: live (auto) or owner-editable (manual) — it can't be both.

## Step 1 — Resolve the Google Place ID (and prove it's the right business)

The number is only as trustworthy as the Place ID. The wrong ID puts **another business's reviews** on this site — the exact failure mode logged in `prompts/lessons/gather.md` (similarly-named local trades). Get this right or stop. You need the Place ID **resource name** (the `ChIJ…` form that goes in `places/<id>`), NOT a Maps CID — the Place Details endpoint only accepts the former.

1. **Resolve it from the Places API, asking for the `id` field explicitly.** (The pipeline's `places-*.js` scripts fetch the listing but don't print its id, and `gathered-content.md` may not have recorded one, so resolve it fresh rather than trusting a script's stdout.)
   ```bash
   KEY="$(grep -E '^GOOGLE_PLACES_API_KEY=' .env | cut -d= -f2- | tr -d '"')"
   curl -s "https://places.googleapis.com/v1/places:searchText" \
     -H "X-Goog-Api-Key: $KEY" \
     -H "X-Goog-FieldMask: places.id,places.displayName,places.formattedAddress,places.userRatingCount" \
     -H "Content-Type: application/json" \
     -d '{"textQuery":"<BUSINESS NAME> <LOCATION>"}'
   ```
   Take the `id` (`ChIJ…`) of the result whose `displayName` and `formattedAddress` unmistakably match THIS client — never blindly the first result. If `gathered-content.md` already lists a `ChIJ…` Place ID, use this call to confirm it still resolves to the same business. (Non-US or non-English operators: add `"regionCode"` and `"languageCode"` from your `.env` country/language codes to the JSON body for sharper matching, the way `places-search.js` does.)
2. **Verify it's the right business.** The `displayName` + address must clearly be this client, not a similarly-named neighbour. If more than one result is plausible, or none clearly matches, STOP and flag it — do not guess (a wrong listing on a live site is unrecoverable). Sanity-check the returned `userRatingCount` against what `gathered-content.md` recorded.

Hold the resolved Place ID; you'll hardcode it in the page (it isn't secret) and record it in Step 9.

## Step 2 — Flip the runtime if the site is a static export

```bash
cd clients/$ARGUMENTS/site
# POSIX-safe detection (BSD/macOS, GNU, and BusyBox grep) — same form the /deploy skill uses
grep -qE "^[[:space:]]*output:[[:space:]]*['\"]export['\"]" next.config.mjs && echo "static export — must flip" || echo "already server-rendered — skip the flip"
```

- **Already server-rendered** (e.g. `/cms` was added earlier): skip — `getPlaceStats`'s ISR works as-is.
- **Static export:** remove `output: 'export'` from `next.config.*` and keep `images: { unoptimized: true }`. (This is the same runtime flip `/cms` performs; the `/deploy` skill already handles server-shaped sites.) Then:
  ```bash
  npm install     # node_modules is usually pruned after deploy
  rm -rf out      # stale static export
  ```

## Step 3 — Install the helper (verbatim)

From the **project root** (Step 2 left you in the site dir):

```bash
SITE=clients/$ARGUMENTS/site
mkdir -p $SITE/src/lib
cp .claude/skills/auto-updating-google-rating/reference/places-stats.ts $SITE/src/lib/places-stats.ts
```

Confirm `tsconfig.json` maps `"@/*"` → `"./src/*"` (scaffold default). Don't edit the helper — the only knob is the Place ID you pass it, in Step 4.

## Step 4 — Wire the live number into the page

The page becomes a server component that fetches the stats once and renders them where social proof already lives.

1. **Find every place the number appears — there's usually more than one.** Built sites repeat their social proof: a hero stat block, a reviews strip, sometimes the footer, each often showing *both* the rating and the count. Grep the whole site, not just the hero:
   ```bash
   grep -rnE "[0-9]\.[0-9]|[0-9]+ (google )?reviews|★|[Rr]ated" clients/$ARGUMENTS/site/src
   ```
   The grep is deliberately broad and will also surface prices, phone digits and version numbers — only wire the ones that are genuinely the Google rating and review count. Every such hardcoded number is one you're making live — wire **all** of them to the same value (Step 4.3), or the page will show inconsistent numbers in different sections, which reads as broken. If the site shows no rating at all, pick the natural social-proof spot (hero sub-line, an "about"/reviews section) and add one. **These sites are multi-page**, so the hits will span several routes and often the shared footer in `_components/`: every route that renders the number must fetch it (fetch in that route's server `page.tsx`, or lift it into a shared server component). A rating wired on `/` only means `/about` keeps showing a frozen number that drifts away from the live one — silently, and the operator has no reason to look.
2. **Fetch in the server page** and pass it down:
   ```tsx
   import { getPlaceStats } from "@/lib/places-stats";

   const PLACE_ID = "ChIJ……"; // resolved + verified in Step 1 — not secret

   // Re-render periodically so the cached rating refreshes (the helper caches
   // the Google call for 7 days; this lets the page pick the new value up).
   export const revalidate = 604800;

   export default async function Page() {
     const stats = await getPlaceStats(PLACE_ID);
     // …pass `stats` into the view…
   }
   ```
   If the page is currently a client component, keep the fetch in the server `page.tsx` and pass the data down as props (the `stats` object, or the finished `ratingStr`/`countStr` from Step 4.3). Do NOT import `@/lib/places-stats` into a client component — keep the helper, and any reference to the key, out of the browser bundle entirely.
3. **Compute the display values once, then substitute at every instance.** In the view, derive both from `stats` with the site's launch numbers as the fallback, and reuse them everywhere the rating/count render — so all the spots from 4.1 stay in lockstep:
   ```tsx
   const ratingStr = stats ? stats.rating.toFixed(1) : "<original rating>"; // e.g. "5.0"
   const countStr  = stats ? formatReviewCount(stats.count) : "<original count>"; // e.g. "8"
   ```
   Because `getPlaceStats` returns `null` on a missing key or API hiccup, this **guards** the page: a failure falls back to the copy that was true at launch — never `0`, `null`, or a broken star row. (Treat a live `stats.count` of `0` the same as the fallback — a listing you're featuring won't really have zero reviews, so a `0` means something's off.) Then replace each hardcoded number with `{ratingStr}` / `{countStr}`. (If instead you're adding a brand-new badge rather than upgrading numbers the site already shows, `reference/GoogleRating.tsx` is a styling starting point — **restyle it to match this site's design**, don't drop in a generic badge.)
4. **Never fabricate.** Only ever show what Google returned. No invented counts, no "10,000+ happy customers" if the listing says 23.

## Step 5 — Make sure Vercel has the key

```bash
cd clients/$ARGUMENTS/site
rm -rf .vercel
npx vercel link --token=$VERCEL_TOKEN ${VERCEL_SCOPE:+--scope=$VERCEL_SCOPE} --yes --project $ARGUMENTS
npx vercel env ls production --token=$VERCEL_TOKEN | grep -q GOOGLE_PLACES_API_KEY && echo "key present" || echo "key MISSING — add it"
```

If missing, set it from the operator's `.env` value (server-only — **never** `NEXT_PUBLIC_`):
```bash
printf '%s' "$(grep -E '^GOOGLE_PLACES_API_KEY=' ../../../.env | cut -d= -f2- | tr -d '"')" \
  | npx vercel env add GOOGLE_PLACES_API_KEY production --token=$VERCEL_TOKEN
```

## Step 6 — Build, and prove it's the live value (not the fallback)

The page is **prerendered at `next build` time**, so the Google number is baked in *during the build* — the key has to be present for `next build`, not just for `next start`. Build with it:

```bash
cd clients/$ARGUMENTS/site
KEY="$(grep -E '^GOOGLE_PLACES_API_KEY=' ../../../.env | cut -d= -f2- | tr -d '"')"
GOOGLE_PLACES_API_KEY="$KEY" npx next build
```

Fix any errors. Then serve the build and compare it to what Google returns right now, to prove the prerender baked the **current** number and not the launch fallback:

```bash
GOOGLE_PLACES_API_KEY="$KEY" npx next start -p 3112 &
sleep 7
echo "Google now:"; curl -s "https://places.googleapis.com/v1/places/<PLACE_ID>" -H "X-Goog-Api-Key: $KEY" -H "X-Goog-FieldMask: rating,userRatingCount"
COUNT=$(curl -s "https://places.googleapis.com/v1/places/<PLACE_ID>" -H "X-Goog-Api-Key: $KEY" -H "X-Goog-FieldMask: userRatingCount" | grep -oE '[0-9]+')
curl -s "http://localhost:3112/" | tr -d ',' | grep -qE "[^0-9]${COUNT}[^0-9]" \
  && echo "LIVE ✓ — the current Google count ($COUNT) is on the page" \
  || echo "NOT LIVE — $COUNT not on the page (key missing on the build, or wrong Place ID)"
pkill -f "next start -p 3112" || true
```

`LIVE ✓` means the build baked the **current** Google count, not the launch fallback — the two are identical until a new review lands, so matching the live count is the only reliable check (the comparison strips thousands separators, so `1,827` on the page matches `1827` from the API). `NOT LIVE` means the key wasn't present for `next build`, or the Place ID is wrong — fix before deploying. A missing key silently bakes the fallback, and because the fallback equals the launch numbers, nothing downstream would otherwise reveal it.

## Step 7 — Deploy

Invoke `/deploy $ARGUMENTS` — don't hand-roll deploy commands. It re-verifies the project link, records the URL, and handles the server-shaped build. The key reaches the live site from the Vercel platform at runtime.

## Step 8 — Verify live

```bash
KEY="$(grep -E '^GOOGLE_PLACES_API_KEY=' .env | cut -d= -f2- | tr -d '"')"
test "$(curl -sS -o /dev/null -w '%{http_code}' "$DEPLOYED_URL/")" = "200" || echo "HOMEPAGE BROKEN — investigate"
echo "Google now:"; curl -s "https://places.googleapis.com/v1/places/<PLACE_ID>" -H "X-Goog-Api-Key: $KEY" -H "X-Goog-FieldMask: rating,userRatingCount"
COUNT=$(curl -s "https://places.googleapis.com/v1/places/<PLACE_ID>" -H "X-Goog-Api-Key: $KEY" -H "X-Goog-FieldMask: userRatingCount" | grep -oE '[0-9]+')
curl -sS "$DEPLOYED_URL/" | tr -d ',' | grep -qE "[^0-9]${COUNT}[^0-9]" \
  && echo "LIVE ✓ — the live site shows the current Google count ($COUNT)" \
  || echo "STUCK — $COUNT not on the live site (fallback, or wrong listing)"
```
This is the same proof as Step 6, on the deployed URL. `STUCK` means the live site is serving the fallback or is pointed at the wrong listing — fix before handover; a wrong rating on a client's live site is worse than none. (Also eyeball the rating from the `Google now:` line against the page.)

## Step 9 — Record + handover

1. Write `clients/$ARGUMENTS/data/google-rating.md`: the verified Place ID, where on the page the rating renders, the refresh cadence (7-day ISR), the fallback behaviour, and that `GOOGLE_PLACES_API_KEY` must stay set on the Vercel project. This is the operator's record.
2. Append one line to `clients/$ARGUMENTS/data/status.md`: `Live Google rating enabled <date> — refreshes weekly from Place ID <id>`.
3. Final message to the operator: confirm it's live, what it shows, that it updates itself weekly, and the one selling line for the client ("your Google rating now stays current on your site automatically — no widget, no monthly fee").

## Rules

- **Vercel only**, server-rendered. On `DEPLOY_PROVIDER=cloudflare`/`netlify`, stop at Step 0.
- **The key stays server-side.** `GOOGLE_PLACES_API_KEY`, never `NEXT_PUBLIC_*`. A leaked Places key gets abused and bills the operator.
- **The 7-day cache is deliberate.** Google bills per Place Details call and rate-limits. Don't drop `revalidate` to a per-request live fetch to make it "more live" — weekly is right for a review count and keeps the cost effectively zero.
- **Never fabricate a count.** `null` → fallback to existing copy or hide. Only ever display what Google returned. (Same rule as the rest of the pipeline: no hallucinated content.)
- **The right-business check (Step 1) is non-negotiable.** A wrong Place ID attributes a stranger's reviews to your client — see the `places:searchText` mismatch lesson in `prompts/lessons/gather.md`.
- **If you show review *text*** (the optional extension in `places-stats.ts`): Google caps it at 5, requires visible "from Google" attribution, and forbids long-term storage of the text. The rating + count badge is the default and needs none of that.
- If anything fails irrecoverably (Vercel API errors, deploy fails, can't verify the right listing), alert via `bash scripts/notify.sh "google-rating $ARGUMENTS: <reason>"` and stop rather than leaving a wrong number live.

## § Maintenance (the site already has a live rating)

- **Wrong / changed Place ID** — re-resolve via Step 1, update the `PLACE_ID` constant everywhere it was placed (`grep -rn PLACE_ID clients/$ARGUMENTS/site/src` — on a multi-page site it may sit in more than one route file), rebuild (Step 6) and redeploy (Step 7), update `google-rating.md`.
- **Owner wants review cards too** — enable the optional `getPlaceReviews` block in `places-stats.ts`, render ≤5 cards with "from Google" attribution, and note the pricier SKU. Rebuild + redeploy.
- **Number looks stale** — it refreshes on the 7-day ISR cycle; a redeploy also refreshes it immediately. If it's stuck on the fallback, the key isn't set on Vercel (Step 5).
- **The client gets rebuilt** — re-running the full `/build` skill does `rm -rf .../site` and reverts this wiring to the hardcoded launch numbers (recoverable — nothing is lost, the figures re-fetch from Google). Re-run this skill after any such rebuild + redeploy to restore the live values.
