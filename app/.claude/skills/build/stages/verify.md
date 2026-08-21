# Stage: verify
Scripts only. Run `bash scripts/pre-qa-gates.sh $ARGUMENTS` BEFORE spawning qa-reviewer.

### Step 5 — Verify (scripts, before handing to QA)

```bash
node scripts/font-check.mjs clients/$ARGUMENTS/site
node scripts/contrast-check.mjs --tokens clients/$ARGUMENTS/site/src/app/globals.css
node scripts/contrast-check.mjs clients/$ARGUMENTS/site/out
node scripts/richness-check.mjs clients/$ARGUMENTS/site
node scripts/verify-design-intent.mjs $ARGUMENTS
node scripts/reconcile-claims.mjs $ARGUMENTS
```
All must PASS before QA. `reconcile-claims.mjs` is the one that checks your own `status.md` claims against the gates that adjudicate them — a build once recorded `HERO_VIDEO=OK` while the playback gate printed FAIL, and shipped. A self-report that contradicts its own gate is a hard fail now, in both directions. `verify-design-intent.mjs` is the one that checks the site against **your
own recorded brief** — scale drama, whether each signature move actually shipped, and uniform-rhythm
runs. `DESIGN_INTENT_CHECK=FAIL` means intent and artifact disagree; fix the artifact. A FAIL here costs seconds; the same FAIL found at QA costs a whole round.

### Context discipline — the measured cause of the compaction spiral

**Measured on the real cold-front-ac build: 56 of its 76 `Read` calls were RE-READS of files the
build had authored itself.** `page.tsx` was re-read 21 times and written 34 times; `site-data.ts` 7
times; `globals.css` and `schema.ts` 5 each. A route's `page.tsx` is 6-10K tokens, so ~21 whole-file
re-reads is on the order of the entire context window, spent re-loading code this build already
wrote.

That is a spiral, not a cost: context fills → compaction → the model no longer holds the code it
authored → it re-reads the whole file to make one edit → context re-inflates → it compacts again.
Nine times in one build, first at minute 12.

**The rules, in priority order:**

1. **Write each route's `page.tsx` ONCE, complete.** A second `Write` to the same route means the
   first pass shipped something you already knew was unfinished. 34 writes across 13 routes is
   iteration that belongs *before* the write, not after it. Use § Incremental per-file check at
   write time so the file is correct on the first pass.
2. **Never re-read a file you authored this session to refresh your memory of it.** If you are
   about to edit it, read only the region you are editing with `offset`/`limit` — never the whole
   file.
3. **To re-orient after a compaction, use the cheap artifacts, not the expensive ones:**
   `node scripts/verify-design-intent.mjs $ARGUMENTS --brief-only` (~8 lines) for design intent,
   and `find clients/$ARGUMENTS/site/src -name '*.tsx'` for what exists. Re-reading generated code
   to remember what you built is the single most expensive way to answer that question.
4. **Batch edits per file.** One read should serve every edit you make to that file, not one edit.

### After a compaction — RUN THIS, do not rely on memory

Measured: a real build compacted **9 times, first at minute 12**, and every page after that was
written from a summary of the design brief rather than the brief. That is the measured cause of
generic output — the build cliff-notes its own notes.

**Immediately after any compaction, run:**
```bash
node scripts/verify-design-intent.mjs $ARGUMENTS --brief-only
```
It prints DESIGN_IDEA, the hero archetype, the ground, and the 3 signature moves back into context
in ~8 lines. A skill instruction survives compaction; your memory of a brief does not. Do not
substitute "I remember the design idea" for running it — that substitution is the defect.

## Verify
```bash
npx next build
```

**Then assert the routes you decided on actually exist.** `npx next build` succeeds perfectly happily on a one-pager, so a missing subpage is a *silent* failure — the exact class of defect this pipeline keeps shipping. Check the emitted artefact, not the source:

```bash
# static export: every marketing route must have produced its own HTML file.
# privacy and terms ship on EVERY build (§ Legal pages) - a MISSING on either is
# never an acceptable drop, unlike a sufficiency-gated /services or /about.
for r in index services about contact blog privacy terms; do
  test -f "out/$r.html" -o -f "out/$r/index.html" && echo "OK   /$r" || echo "MISSING /$r"
done

# and that the footer actually links to them from every page - a legal page nobody
# can reach is the same defect as no legal page.
for f in out/index.html out/services.html out/about.html out/contact.html; do
  test -f "$f" || continue
  grep -q 'href="/privacy"' "$f" && grep -q 'href="/terms"' "$f" \
    && echo "OK   footer legal links on $f" || echo "MISSING footer legal links on $f"
done

# and every article the blog claims to have. A dynamic segment missing
# generateStaticParams() emits ZERO article HTML and still exits 0.
grep -o 'slug: "[^"]*"' src/app/_components/blog-data.ts | cut -d'"' -f2 | while read s; do
  test -f "out/blog/$s.html" && echo "OK   /blog/$s" || echo "MISSING /blog/$s"
done
test "$(ls out/blog/*.html 2>/dev/null | wc -l | tr -d ' ')" = "5" \
  && echo "OK   5 articles exported" || echo "WRONG article count in out/blog/"
```

Every route § Site structure said should ship must print `OK`. A `MISSING` line for a route you deliberately dropped is fine **only if the drop and its counts are written in `status.md`** — otherwise the site is a one-pager by accident and you go back and write the page before QA. Do not proceed on a green `next build` alone.

**Then assert the hero video was actually attempted, not silently skipped** (§ Motion, chat and hero video → `<HeroVideo />`). This is a build-quality regression gate, not a route-existence check — a build with real usable photos and no hero video attempt is exactly the defect that shipped once already:

```bash
grep -qE '^HERO_VIDEO=(OK|FAIL)' clients/$ARGUMENTS/data/status.md \
  && echo "OK   hero video step recorded" \
  || echo "MISSING hero video step never attempted or never recorded in status.md"

test -f "clients/$ARGUMENTS/site/public/hero.mp4" -a -f "clients/$ARGUMENTS/site/public/hero-poster.jpg" \
  && echo "OK   hero.mp4 + hero-poster.jpg present" \
  || echo "NOTE  no hero clip on disk — acceptable ONLY if status.md records HERO_VIDEO=FAIL (fewer than 3 usable photos)"
```

A `MISSING` on the first check means `node services/hero-video/render.mjs --slug $ARGUMENTS` was never even run — go back and run it before QA. A `NOTE` on the second is fine exactly when the first check's status.md line reads `HERO_VIDEO=FAIL`; if it reads `HERO_VIDEO=OK` but the files aren't on disk, something silently dropped the output and needs investigating, not shrugging off.

> **`out/services.html` is the right artefact to check, not `out/services/`.** A static export also emits a `services/` directory holding only RSC payload `.txt` files. `python3 -m http.server` sees that directory and 301-redirects `/services` to `/services/`, which has no `index.html` — a purely local artefact of a server with no clean-URL handling. `npx serve out` and Vercel's filesystem handler both serve `/services` from `services.html` and return 200. Verify the extensionless paths on the LIVE deploy (the deploy skill does this), never conclude a 404 from `python3 -m http.server` alone.

**Then assert the fonts actually reached the page** — the same class of silent failure, and the one that discards the whole typography step (see § Step 2 — Typography → "How to LOAD the fonts"). Run from the repo root:

```bash
node scripts/font-check.mjs clients/$ARGUMENTS/site
```

It must print `FONT_CHECK=PASS`. A `FAIL` means the site is rendering in Georgia/Helvetica no matter how correct `globals.css` looks — fix the loading mechanism, rebuild, re-run. Do not hand a `FONT_CHECK=FAIL` build to QA.

**Then assert every rendered text element clears WCAG** — the computed backstop behind § Design (HARD RULES)
roles. Because the palette is derived, this should be proving a property that is already true; a
FAIL means a freehand colour bypassed the role tokens (or an overlay/glow shifted a surface) and
the build does not ship until it passes. From the repo root:

Run both together, backgrounded and reaped with `wait` (Fable consult, 2026-08-19 — the rendered
check is documented elsewhere as the single most expensive script in the whole battery; the two are
fully independent, so there's no reason to pay for them serially):
```bash
node scripts/contrast-check.mjs --tokens clients/$ARGUMENTS/site/src/app/globals.css > /tmp/contrast-tokens-$$.log 2>&1 &
node scripts/contrast-check.mjs clients/$ARGUMENTS/site/out > /tmp/contrast-rendered-$$.log 2>&1 &
wait
cat /tmp/contrast-tokens-$$.log /tmp/contrast-rendered-$$.log
rm -f /tmp/contrast-tokens-$$.log /tmp/contrast-rendered-$$.log
```

The first line is the STATIC token audit (`TOKEN_CHECK=PASS` required): it verifies the full
derived token set is present in `:root` and every declared pair still passes — this is the only
gate that can see tokens which render on interaction (error text, toasts, validation banners),
because a resting page never paints them. The second serves the export itself, walks EVERY page at desktop and mobile widths, composites
translucent layers from the rendered page, and applies the real per-element threshold (3.0:1 for
large text, 4.5:1 otherwise). It must print `CONTRAST_CHECK=PASS`. Never eyeball a disputed
ratio: white-on-gold at 2.9:1 looks like a handsome button, which is exactly how three builds
shipped it. Do not hand a `CONTRAST_CHECK=FAIL` build to QA.

Keep going — FONT_CHECK/TOKEN_CHECK/CONTRAST_CHECK passing is necessary but not sufficient; the
marker that tells QA it can skip re-running gets written once ALL SIX Verify checks (font, token, contrast, richness, reviews, nav-visibility — the two HyperUI gates were deleted 2026-08-19).

**Then assert the motion and chat pieces reached the artefact**, for the same reason
— all three fail silently and all three are things the recurring fee is sold on:

```bash
cd clients/$ARGUMENTS/site
test -s public/chat-kb.json && python3 -m json.tool public/chat-kb.json >/dev/null \
  && echo "OK   chat-kb.json valid" || echo "MISSING chat-kb.json (the chatbot cannot work without it)"
test -f out/chat-kb.json && echo "OK   chat-kb.json exported" || echo "MISSING chat-kb.json in out/"
grep -qr 'data-reveal' src/app && echo "OK   reveal hooks present" || echo "MISSING data-reveal hooks"
grep -q '<Motion' src/app/layout.tsx && echo "OK   Motion mounted" || echo "MISSING <Motion /> in layout"
grep -q '<SiteChat' src/app/layout.tsx && echo "OK   SiteChat mounted" || echo "MISSING <SiteChat /> in layout"
grep -q 'opacity:0\|opacity: 0' src/app/globals.css && echo "WARNING: a hidden state in globals.css can blank the page if JS fails — it belongs in Motion.tsx, nowhere else"
grep -q 'usePathname' src/app/_components/Motion.tsx \
  && echo "OK   Motion rebuilds reveals per route" \
  || echo "BROKEN: Motion is mount-only — every subpage reached by tapping the menu will render as a hero, a void and a footer"
grep -q 'data-\[scrolled=false\]' src/app/_components/SiteNav.tsx \
  && echo "BROKEN: nav background is styled only off data-scrolled — it has NO background when the attribute is absent" \
  || echo "OK   nav owns its own solid state"
grep -q 'data-chat-gutter' src/app/_components/SiteFooter.tsx \
  && echo "OK   footer reserves the chat launcher corner" \
  || echo "MISSING data-chat-gutter on the footer's last row (the chat bubble will sit on the copyright line)"
```

A `MISSING` on the KB is the one that matters most: the chat bubble will still
render and the visitor will still be able to type, and every message will come back
as the phone-number fallback. That is precisely how Gray Reserve's own chatbot sat
dead on production for weeks while answering HTTP 200.

**Then assert the AEO baseline reached the artefact** — same silent-failure class again, and this one is
what the "ongoing SEO, AEO and GEO work" line in the outreach copy has to stand on. From the repo root:

```bash
node scripts/aeo-check.mjs clients/$ARGUMENTS/site
```

It must print `AEO_CHECK=PASS`. It validates the entity graph (parses, one business `@id` across every
route, per-page `WebPage` `@id`s, no dangling `@id` edges, no empty properties), proves every FAQ question
is a **rendered heading** and every answer is in the **visible page text**, proves NAP is present on every
route and matches the schema, checks `llms.txt` against the llmstxt.org shape with its links resolving to
real routes, checks the sitemap covers exactly the built routes, and confirms no live-retrieval crawler is
blocked. **Every text assertion is made with `<script>` stripped**, so a fact that lives only in the RSC
payload fails here instead of passing a naive grep.

What it does NOT prove, and must never be reported as proving: that any answer engine will cite the site.
There is no artefact-level test for a citation.

**First, mechanically auto-fix the two defect classes that never need a model turn (Fable consult,
2026-08-19).** Missing `<img>` width/height and banned em/en-dashes are the two most common single
findings across real QA reports, and both are purely mechanical — the fix is "read the real pixel
size" and "substitute punctuation", never a design or copy judgement call. Fixing them with a script
before richness-check even runs means richness-check has nothing to flag and QA never spends a round
on either:
```bash
node scripts/fix-img-dims.mjs $ARGUMENTS
node scripts/fix-dashes.mjs $ARGUMENTS
```
`fix-img-dims.mjs` only fixes `<img>` tags with a literal `/images/...` string src — it reports
(never guesses at) anything with a dynamic/interpolated src, which needs your own judgement.
`fix-dashes.mjs` only substitutes punctuation (comma for a spaced em-dash, hyphen otherwise/for a
digit range) — it never rewrites a sentence, so if the resulting prose reads awkwardly, that's worth
a manual pass, but the mechanical defect itself is already closed. Both skip JSX/JS comments.

**Then run richness verification HERE, not only at QA (Fable consult, 2026-08-19 — shift-left).**
This used to run for the first time in QA, meaning a FAIL there cost a whole round: rebuild,
re-screenshot, re-gate, re-review — measured at 45-70+ minutes on a real dispatch, against
~seconds to run the same script here before handoff. A real client build's round-1 critical was
exactly this class: richness shipped 2 gradients against a 5-gradient design-manifest plan,
invisible to every other Verify check, would have been a 2-minute self-fix here instead of a lost
round.

**HyperUI is deleted from this pipeline as of 2026-08-19 (Jeff's explicit call) — the reference
catalog, both gate scripts, and the lookup tool are gone, not just unwired.** It was made mandatory
2026-08-16 to fix a specific earlier problem (a build that had a reference set available and never
opened a single file), but the fix overshot: the-woodlands-plumbing-and-air (2026-08-16, before
HyperUI adoption existed) is the actual quality bar this pipeline is chasing, and the mandatory
cycle added since — search a 469-file catalog, pick 6+ components across 4+ categories, wire and
cite each one, clear two hard-FAIL gates — added real, measured time without moving the site closer
to that bar. cold-front-ac (2026-08-19) shipped 16 gate-PASSING citations and still read as
generic; a review confirmed the actual generic pattern on that build was hand-written, not
HyperUI-sourced at all. Every section is now authored directly against the design system, richness
rules, and composition guidance in this file — no external component library involved.

Independent of the nav-visibility check further below — run both together in one backgrounded batch
rather than two separate tool-call turns (same pattern as the QA gate battery; the concurrent-write
paths they share, `data/design-fingerprints.json`, are already mkdir-lock-protected):
```bash
node scripts/richness-check.mjs clients/$ARGUMENTS/site > /tmp/vf-richness-$$.log 2>&1 &
node scripts/verify-reviews.mjs $ARGUMENTS > /tmp/vf-reviews-$$.log 2>&1 &
node scripts/verify-nav-visibility.mjs clients/$ARGUMENTS/site/out > /tmp/vf-nav-$$.log 2>&1 &
wait
cat /tmp/vf-richness-$$.log /tmp/vf-reviews-$$.log /tmp/vf-nav-$$.log
rm -f /tmp/vf-richness-$$.log /tmp/vf-reviews-$$.log /tmp/vf-nav-$$.log
```

**`verify-reviews.mjs` closes the worst defect class this pipeline can ship** — a fabricated review
published under a real business's name — which until now had NO deterministic check anywhere in
the pipeline, only the three-bucket-truth-rule's prose. It scans every review/testimonial-shaped
object literal in the built `.tsx` source and confirms the quote text appears verbatim in
`gathered-content.md`. `REVIEW_CHECK=FAIL` is CRITICAL: hand-verify each flagged quote against
`gathered-content.md` (a real quote with trivial punctuation cleanup is a false positive; an author
name that appears nowhere in the gathered content is fabrication) and replace any genuinely
invented review with a real one from `gathered-content.md`'s Reviews section before proceeding.

**Then verify nav-link contrast at scroll=0 with a PIXEL-SAMPLED check, not the ancestor-walk
`contrast-check.mjs` above uses (Fable consult, 2026-08-19).** A real client build shipped a
`position: fixed` transparent nav with light-on-dark link styling — invisible against a light
subpage until the visitor scrolls. `contrast-check.mjs` ran clean (0 failures) against the exact
reproduced bug: its ancestor-walk reads what a `position:fixed` element's DOM PARENT paints, not
what visually sits behind it once the element escapes normal flow — a fixed element's real backdrop
is whatever page content happens to be scrolled underneath it, which has no DOM relationship to it
at all. `verify-nav-visibility.mjs` instead screenshots the real rendered page and samples the
actual pixel colour behind each nav link, the same methodology this project's own contrast tooling
already trusts over DOM inference for exactly this class of ambiguity. (Already run as part of the
5-check parallel batch above — `vf-nav-$$.log` — nothing further to invoke here.)

`NAV_VISIBILITY_CHECK=FAIL` is CRITICAL: a nav link is unreadable against its real rendered
backdrop at first load. Fix by either giving the nav a real background at all times (simplest,
most robust) or darkening/lightening the underlying content enough that the transparent state
stays legible everywhere it can appear — never by trusting `contrast-check.mjs`'s PASS on the same
element, which cannot see this failure mode. `SKIP` is normal if the site has no `[data-nav]`
element with links (not this template) — not a finding.

⚠️ **Separately, while building this check, a serious pre-existing bug in `contrast-check.mjs`
itself was found and fixed: its local static server 404s on every CSS/JS/font request under a
shared-lane build** (the document serves at root but `next.config.mjs`'s mandatory `assetPrefix`
points assets at `/klaudius/<slug>/...`), so the page it evaluated had **zero real styling** —
unstyled default-browser HTML reads as good contrast by default, so this was producing a
false-clean `CONTRAST_CHECK=PASS` on every shared-lane build, not a nav-specific gap. Confirmed on
a real build: after the fix, the SAME already-deployed-looking build went from `0 failures / 584
elements` to `48 failures / 524 elements` — real, previously invisible defects (near-white text on
near-white backgrounds across most sections). The fix (strip the `/klaudius/<slug>/` prefix before
resolving to `out/`) is already applied in `contrast-check.mjs` — nothing to change in how you
invoke it above, but treat any PRE-2026-08-19 `CONTRAST_CHECK=PASS` recorded in an existing
client's `status.md`/`qa-report.md` as unverified, not evidence of clean contrast.

All THREE checks in this section — richness, reviews (`REVIEW_CHECK`), and nav visibility
(`NAV_VISIBILITY_CHECK`) — must print PASS (or the appropriate SKIP — see each script's own
QA-section documentation above for what SKIP means and when it's normal, not a finding). A FAIL on
any of them here means: go fix the actual gap (add the missing gradients/textures, replace an
invented review with a real one, give the nav a legible resting state) and re-run — same discipline
as `FONT_CHECK=FAIL` above. Do not hand a build with a FAIL on any of these three to QA; that is
exactly the cost this section exists to avoid paying twice.

**If FONT_CHECK, TOKEN_CHECK, CONTRAST_CHECK, and all three checks above genuinely printed PASS (or
a normal SKIP) — all six, not just the first three — record it now** so QA doesn't re-run any of
them against the identical artefact (Fable consult, 2026-08-19 — extends the original 3-check
dedupe to cover the shift-left checks added the same night; HyperUI usage/transplant removed from
this dedupe 2026-08-19, they no longer run at all):
```bash
echo "VERIFY_GATES_OK_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> clients/$ARGUMENTS/data/status.md
```
Only write this line if every one of the six genuinely passed (or SKIPped legitimately). Skip it
if anything FAILed and you're about to fix-and-rebuild — a stale/wrong marker is worse than no
marker, since QA's freshness check trusts it without re-verifying the claim itself.

Rescue leads with a parity checklist: after the build, self-check with `node scripts/parity-check.js $ARGUMENTS` (from the repo root) — it must exit clean; QA runs the same check and hard-fails on misses.

## Update status (MANDATORY - do this last)
After a successful build, update the client status in Supabase:
```bash
python3 -c "from scripts.db import update_status; update_status('$ARGUMENTS', 'built')"
```
Do NOT rely on the calling session to remember this — it must happen here before build is complete.
