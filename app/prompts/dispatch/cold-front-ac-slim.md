Rebuild Cold Front A/C Of The Woodlands (slug `cold-front-ac`) — HVAC contractor, The Woodlands TX,
phone +18325598236. COMPETE mode: their own site (coldfrontacofthewoodlands.com) is fine, so the
pitch is what $598 + $98/mo adds, never "you don't have a website".

## What to reuse and what to redo

**REUSE gather — do NOT re-run `/gather`.** `clients/cold-front-ac/data/gathered-content.md` is
valid (188 lines: identity, 16 services, hours, about, service area, 5 real reviews, photos,
credibility). Read it and trust it.

**REDO design and build from scratch.** `rm -rf clients/cold-front-ac/site` first. The existing
build predates a major change to the build skill and is the thing being replaced.

## What changed in the skill since the last build — this run is the test of it

1. **The design section was reset**: ~1,000 lines of prose describing how a page should *feel* were
   replaced by ONE short section where every rule states a NUMBER or names a SCRIPT. Read it. The
   12-row hard-rule table is the spec — hit the numbers.
2. **New gate `scripts/verify-design-intent.mjs`** checks the BUILT site against your own recorded
   brief: scale drama (largest heading ≥3.5× body), whether each signature move left a real trace
   in the shipped HTML/CSS, and uniform-rhythm runs. It runs in Verify and again in QA.
3. **New context-discipline rules.** The previous build compacted **9 times** because 56 of its 76
   `Read` calls were re-reads of files it had authored itself (`page.tsx` re-read 21×, written
   34×). That spiral is what made the last build slow AND generic — the design brief was compacted
   away at minute 12 and every page after was written from a summary of it.

**Obey the context rules literally, they are the point of this run:**
- Write each route's `page.tsx` ONCE, complete. Do not come back to patch it.
- NEVER whole-file re-read something you authored. Use `offset`/`limit` on the region you're editing.
- After ANY compaction, run `node scripts/verify-design-intent.mjs cold-front-ac --brief-only`
  (~8 lines) to reload the design brief. Do NOT re-read generated code to remember what you built.
- Batch edits: one read serves every edit to that file.

## The design bar

The last build passed every gate and the operator called it flat — 13 identical `<h3>` on
`/services` and 13 `<h4>` on the home page, all one size, nothing featured, while its own recorded
signature move promised "emergency repair as a dominant bento cell breaking the rhythm" that never
shipped. **Do not repeat that.** Commit to a ground direction hard, land one real scale moment, and
make the dominant element genuinely dominant in the markup, not in the status.md wording.

## Pipeline

`/ui-ux-pro-max` (fresh) → `/build cold-front-ac` → QA loop (max 3 rounds) → deploy.

⛔ **DEPLOY THE SITE, BUT SKIP THE GHL MIRROR ENTIRELY.** This prospect already received their
first-touch email today (2026-08-19T08:10:06Z) and the contact is already tagged `demo-built`.
Re-running the mirror risks a SECOND cold first-touch to a real business owner, which is the worst
thing this pipeline can do to a lead. Publish the static site to the same URL
(`cold-front-ac.grayreserve.agency`) so their existing link gets the better version, confirm 200,
and stop. Do not run `/outreach`. Do not apply any GHL tag. Do not create an opportunity.

## Report honestly in status.md

Record: DESIGN_IDEA + the 3 signature moves actually chosen; whether `DESIGN_INTENT_CHECK` passed
clean or caught something; QA verdict and round count; how many times you noticed a compaction; the
deploy URL with its 200 confirmation. If the result still reads generic, say so plainly — this is a
real test, not a formality, and an honest negative is worth more than a padded pass.
