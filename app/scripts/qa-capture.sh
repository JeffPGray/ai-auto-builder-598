#!/usr/bin/env bash
# qa-capture.sh <slug> — QA Step 3, Call 3: screenshots + the parallel gate battery + teardown.
#
# EXTRACTED VERBATIM from .claude/agents/qa-reviewer.md on 2026-08-19. Nothing about the mechanism
# changed; the only edit is {slug} -> "$SLUG".
#
# WHY THIS IS A SCRIPT NOW. qa-reviewer.md was 836 lines / ~22K tokens, and 319 of those lines were
# mechanical bash the QA agent had to carry in its prompt on every single round. Measured the same
# day on a real build: the pipeline compacted 9 times because context filled faster than it could
# be spent, and everything written after the first compaction was authored from a summary rather
# than the source. Orchestration bash is pure machinery — it needs zero model judgement — so it is
# the cheapest 300 lines to move out of a prompt and into a file that runs without being read.
#
# The comments below are load-bearing: they encode real failures (port races between parallel QA
# runs, orphaned playwright sessions, why the EXIT trap must NOT also trap INT/TERM/HUP). They cost
# nothing here because the model never loads this file.
set -uo pipefail
SLUG="${1:?usage: qa-capture.sh <slug>}"
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

cd "clients/$SLUG/site" || exit 1
mkdir -p qa-screenshots
# `set -u` is on, so every variable the EXIT trap touches must exist BEFORE the trap is armed —
# otherwise an early failure fires the trap against an unbound name and teardown itself dies.
PORT=""; STALE_PORT=""; QA_SERVE_PID=""
# GUARANTEED TEARDOWN via EXIT trap on BOTH sessions — fires on normal end, error, `exit`, and
# SIGTERM/SIGHUP/SIGINT reaps, so a crashed or timed-out QA run no longer orphans either browser.
# playwright-cli sessions never self-close, and on a machine running the pipeline they pile up fast
# without this. DO NOT also trap INT/TERM/HUP to "harden" it: an explicit signal trap DEFERS
# teardown until the hung foreground command returns, which regresses the common leader-only-SIGTERM
# reap into a leak; EXIT-only rides bash's fatal-signal path that force-runs the trap; SIGKILL stays
# uncatchable (that residual needs a periodic sweeper, not a trap). The guards stop an empty
# $STALE_PORT / $QA_SERVE_PID from pkill-ing or kill-ing unrelated processes. Substitute "$SLUG" in
# both close lines below too, exactly like every other -s=qa-"$SLUG"-* line.
trap '[ -n "$QA_SERVE_PID" ] && kill "$QA_SERVE_PID" 2>/dev/null; [ -n "$STALE_PORT" ] && pkill -f "http.server $STALE_PORT --directory" 2>/dev/null; npx playwright-cli -s=qa-"$SLUG"-desktop close 2>/dev/null; npx playwright-cli -s=qa-"$SLUG"-mobile close 2>/dev/null || true' EXIT

# ---- THE SERVER EVERY BROWSER CHECK BELOW MEASURES AGAINST --------------------------------
# This call OWNS the QA server. It used to inherit whatever Call 2 bound, which is
# `python3 -m http.server <port> --directory out` — and that server is WRONG for this template.
#
# next.config.mjs sets a mandatory assetPrefix of `/klaudius/<slug>`, so the document serves at `/`
# while every CSS/JS/font URL inside it is prefixed. `http.server` has no idea about the prefix and
# 404s every one of them. The page then renders unstyled and NEVER HYDRATES — silently, with an
# empty console, because a module that is never requested cannot fail loudly.
#
# Measured on cold-front-ac, 2026-08-19, same build, two servers:
#   http.server  -> CSS 404, JS 404, hero <video> readyState 0 / paused / videoWidth 0, no WCAG
#                   pause control in the DOM at all  => HERO_VIDEO_PLAYBACK_CHECK=FAIL (a FALSE red)
#   qa-serve.mjs -> CSS 200, JS 200, readyState 4, currentTime advancing, pause control present
#                   => HERO_VIDEO_PLAYBACK_CHECK=PASS
# Every screenshot in this file was being taken of that same unstyled, dead page, and the visual
# review that reads them could not tell. Replacing the server is therefore not a tidy-up: it is the
# difference between this whole call measuring the site and measuring a rendering failure.
#
# Call 2 is left alone deliberately (it is agent prose owned elsewhere, and it also proves the port
# is bindable). We kill its server and bind our own. qa-serve picks its OWN free port rather than
# reusing Call 2's, because reusing it races the kill: `pkill` returns before the socket leaves
# TIME_WAIT and the new bind would intermittently EADDRINUSE. Everything downstream — including
# verify-hero-video.mjs — reads the port from .qa-port, which qa-serve rewrites, so a new port
# propagates on its own.
for i in 1 2 3 4 5 6 7 8 9 10; do [ -s .qa-port ] && break; sleep 0.3; done
[ -s .qa-port ] && STALE_PORT=$(cat .qa-port)
[ -n "$STALE_PORT" ] && pkill -f "http.server $STALE_PORT --directory" 2>/dev/null
rm -f .qa-port
node ../../../scripts/qa-serve.mjs . > /tmp/qa-serve-"$SLUG".log 2>&1 &
QA_SERVE_PID=$!
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do [ -s .qa-port ] && break; sleep 0.25; done
PORT=$(cat .qa-port 2>/dev/null || true)
if [ -z "$PORT" ]; then
  echo "SERVE_SANITY_CHECK=FAIL — qa-serve.mjs never wrote .qa-port. Its log:"; cat /tmp/qa-serve-"$SLUG".log
  echo "Every browser check in this call would measure nothing. Aborting the QA capture."
  exit 1
fi
for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null "http://localhost:$PORT" && break; sleep 0.5; done

# ---- SERVE SANITY (deterministic, MANDATORY, HARD-ABORTS THIS CALL) -----------------------
# The point of a gate is that a wrong answer cannot be walked past. Swapping the server above is
# worthless if a future change silently breaks it again and the run carries on measuring a dead
# page — which is exactly the failure this replaces. So prove it, here, every round: pull the first
# real asset URL out of the shipped index.html (the prefixed one the BROWSER will request, not a
# path we construct) and require a 200 through this server. Anything else aborts the capture
# instead of producing 21 screenshots of an unstyled page and a battery of false reds.
ASSET=$(grep -oE '(href|src)="/klaudius/[^"]+\.(css|js)"' out/index.html 2>/dev/null | head -1 | sed -E 's/^(href|src)="//; s/"$//')
if [ -z "$ASSET" ]; then
  # No prefixed asset in the document: either KLAUDIUS_ASSET_PREFIX='' (a legitimate escape hatch
  # in next.config.mjs) or an unstyled build. Fall back to asserting SOME stylesheet resolves —
  # never silently skip, because "found nothing to check" is how a broken build looks too.
  ASSET=$(grep -oE 'href="[^"]+\.css"' out/index.html 2>/dev/null | head -1 | sed -E 's/^href="//; s/"$//')
fi
if [ -z "$ASSET" ]; then
  echo "SERVE_SANITY_CHECK=FAIL — out/index.html references no stylesheet at all. The build is"
  echo "  broken or was never run; screenshots of it would be meaningless. Aborting."
  exit 1
fi
ASSET_CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT$ASSET")
if [ "$ASSET_CODE" != "200" ]; then
  echo "SERVE_SANITY_CHECK=FAIL — the QA server 404s the page's own assets ($ASSET_CODE on $ASSET)."
  echo "  The page will render unstyled and will NOT hydrate, so every screenshot, contrast,"
  echo "  nav-visibility and hero-video result from this call would be measuring a dead page."
  echo "  This is the python3 -m http.server / assetPrefix fault — see the block above. Aborting."
  exit 1
fi
echo "SERVE_SANITY_CHECK=PASS — assets resolve through the QA server (200 on $ASSET), page will hydrate."

# Gate battery launched HERE, now, in the background — overlapped with ALL screenshot work below
# instead of waiting until after it (Fable consult, 2026-08-19). Safe to overlap because these 9
# scripts each launch their OWN separate browser instance (chromium.launch() inside contrast-check/
# nav-visibility) or touch no browser at all — none of them shares the qa-"$SLUG"-desktop/-mobile
# playwright SESSIONS the screenshot code below uses, so there's no race. (The screenshot phases
# themselves stay sequential to each other — home then subpages — because subpages deliberately
# REUSES those same two sessions; concurrent navigation on one shared session would be a real race.
# Only the gate battery, which shares no session with anything, moves.) Waited on once at the very
# end of this call, after every screenshot phase, not here.
mkdir -p /tmp/qa-gates-"$SLUG"
VERIFY_AT=$(grep -oE '^VERIFY_GATES_OK_AT=.*' ../data/status.md 2>/dev/null | tail -1 | cut -d= -f2)
VERIFY_FRESH=0
if [ -n "$VERIFY_AT" ]; then
  # TZ=UTC is LOAD-BEARING. build/SKILL.md writes this marker with `date -u`, i.e. a UTC stamp.
  # BSD `date -jf` has no timezone in the format, so it parses those digits as LOCAL time. In any
  # negative-UTC-offset zone (CDT = UTC-5) the marker lands HOURS IN THE FUTURE, nothing is ever
  # "newer" than it, VERIFY_FRESH stays 1, and the five carried gates below are written as literal
  # PASS strings WITHOUT BEING RUN: FONT_CHECK, CONTRAST_CHECK, TOKEN_CHECK, REVIEW_CHECK,
  # NAV_VISIBILITY_CHECK. Measured 2026-08-19: a marker at 18:38:40Z parsed to 18:38:40 CDT, a
  # 5-hour skew, while out/index.html had been rebuilt 30 minutes AFTER the marker and still read
  # as fresh. NAV_VISIBILITY_CHECK genuinely FAILs on 3 of 5 clients, so this was burying real
  # findings, not hypotheticals. GNU date (-d) already handles the trailing Z correctly.
  VERIFY_EPOCH=$(TZ=UTC date -jf "%Y-%m-%dT%H:%M:%SZ" "$VERIFY_AT" +%s 2>/dev/null || date -d "$VERIFY_AT" +%s 2>/dev/null)
  if [ -n "$VERIFY_EPOCH" ]; then
    touch -d "@$VERIFY_EPOCH" "/tmp/.verify-marker-"$SLUG"" 2>/dev/null \
      || touch -t "$(date -r "$VERIFY_EPOCH" +%Y%m%d%H%M.%S 2>/dev/null)" "/tmp/.verify-marker-"$SLUG"" 2>/dev/null
  fi
  if [ -f "/tmp/.verify-marker-"$SLUG"" ] && [ -z "$(find out src/app/globals.css ../data/status.md -newer "/tmp/.verify-marker-"$SLUG"" -type f 2>/dev/null | head -1)" ]; then
    VERIFY_FRESH=1
  fi
  rm -f "/tmp/.verify-marker-"$SLUG""
fi
if [ "$VERIFY_FRESH" = "1" ]; then
  echo "FONT_CHECK=PASS (carried from Verify, out/ unchanged since $VERIFY_AT)" > /tmp/qa-gates-"$SLUG"/font-check.log
  echo "CONTRAST_CHECK=PASS (carried from Verify, out/ unchanged since $VERIFY_AT)" > /tmp/qa-gates-"$SLUG"/contrast.log
  echo "TOKEN_CHECK=PASS (carried from Verify, globals.css unchanged since $VERIFY_AT)" > /tmp/qa-gates-"$SLUG"/token.log
  echo "REVIEW_CHECK=PASS (carried from Verify, out/ unchanged since $VERIFY_AT)" > /tmp/qa-gates-"$SLUG"/reviews.log
  echo "NAV_VISIBILITY_CHECK=PASS (carried from Verify, out/ unchanged since $VERIFY_AT)" > /tmp/qa-gates-"$SLUG"/nav-visibility.log
else
  node ../../../scripts/font-check.mjs . > /tmp/qa-gates-"$SLUG"/font-check.log 2>&1 &
  node ../../../scripts/contrast-check.mjs out > /tmp/qa-gates-"$SLUG"/contrast.log 2>&1 &
  node ../../../scripts/contrast-check.mjs --tokens src/app/globals.css > /tmp/qa-gates-"$SLUG"/token.log 2>&1 &
  ( cd ../../.. && node scripts/verify-reviews.mjs "$SLUG" ) > /tmp/qa-gates-"$SLUG"/reviews.log 2>&1 &
  node ../../../scripts/verify-nav-visibility.mjs out > /tmp/qa-gates-"$SLUG"/nav-visibility.log 2>&1 &
fi
# HyperUI usage/transplant checks REMOVED from the gate battery 2026-08-19 (Jeff's call — the
# scripts, reference catalog, and lookup tool are deleted entirely). They no longer run at all,
# carried or fresh.
( cd ../../.. && node scripts/font-uniqueness-check.mjs "$SLUG" ) > /tmp/qa-gates-"$SLUG"/font-uniqueness.log 2>&1 &
( cd ../../.. && node scripts/verify-hero-video.mjs --slug "$SLUG" ) > /tmp/qa-gates-"$SLUG"/hero-video.log 2>&1 &
( cd ../../.. && node scripts/verify-design-intent.mjs "$SLUG" ) > /tmp/qa-gates-"$SLUG"/design-intent.log 2>&1 &
( cd ../../.. && node scripts/verify-photos.mjs "$SLUG" ) > /tmp/qa-gates-"$SLUG"/photo.log 2>&1 &
( cd ../../.. && node scripts/copy-fingerprint-check.mjs "$SLUG" ) > /tmp/qa-gates-"$SLUG"/copy-fingerprint.log 2>&1 &

(
  npx playwright-cli -s=qa-"$SLUG"-desktop open "http://localhost:$PORT"
  sleep 1
  npx playwright-cli -s=qa-"$SLUG"-desktop screenshot --filename=qa-screenshots/qa-top.webp --type webp
  npx playwright-cli -s=qa-"$SLUG"-desktop eval "window.scrollTo(0, document.body.scrollHeight / 3)"
  sleep 1
  npx playwright-cli -s=qa-"$SLUG"-desktop screenshot --filename=qa-screenshots/qa-mid.webp --type webp
  npx playwright-cli -s=qa-"$SLUG"-desktop eval "window.scrollTo(0, document.body.scrollHeight * 2 / 3)"
  sleep 1
  npx playwright-cli -s=qa-"$SLUG"-desktop screenshot --filename=qa-screenshots/qa-bottom.webp --type webp

  # Gallery void check (deterministic) — measures the empty-column gap that top-only screenshots
  # miss (the failure that shipped on ~20% of our sites). Run at desktop width: scroll through to
  # load every image, then measure each multi-column masonry container's column-height imbalance
  # (photo galleries AND review/testimonial card columns). Prints GALLERY_VOID_PCT=<n> (worst
  # section; 0 = none/balanced). Step 4 gates on it.
  npx playwright-cli -s=qa-"$SLUG"-desktop resize 1366 1000
  npx playwright-cli -s=qa-"$SLUG"-desktop eval "(function(){for(var y=0;y<document.body.scrollHeight;y+=500){window.scrollTo(0,y);}window.scrollTo(0,0);return 1;})()"
  sleep 2
  npx playwright-cli -s=qa-"$SLUG"-desktop eval "(function(){var A=document.querySelectorAll('div,section,ul,figure');var worst=0;for(var i=0;i<A.length;i++){var el=A[i];if(!(parseInt(getComputedStyle(el).columnCount)>1))continue;var K=el.children;if(K.length<3)continue;if(el.getBoundingClientRect().height<250)continue;var cols=[];for(var k=0;k<K.length;k++){var r=K[k].getBoundingClientRect();if(r.height===0)continue;var b=null,bd=1e9;for(var c=0;c<cols.length;c++){var d=Math.abs(cols[c].x-r.left);if(d<bd){bd=d;b=cols[c];}}if(b&&bd<40){if(r.bottom>b.bottom)b.bottom=r.bottom;if(r.top<b.top)b.top=r.top;}else cols.push({x:r.left,bottom:r.bottom,top:r.top});}if(cols.length<2)continue;var mx=-1e9,mn=1e9,tp=1e9;for(var c2=0;c2<cols.length;c2++){if(cols[c2].bottom>mx)mx=cols[c2].bottom;if(cols[c2].bottom<mn)mn=cols[c2].bottom;if(cols[c2].top<tp)tp=cols[c2].top;}var h=mx-tp;var v=h>0?Math.round((mx-mn)/h*100):0;if(v>worst)worst=v;}return 'GALLERY_VOID_PCT='+worst;})()"

  # RENDERED depth + body typography (Fable consult, 2026-08-18 — folded in here instead of two
  # later separate calls; same measurements the subpages loop below also takes per route).
  npx playwright-cli -s=qa-"$SLUG"-desktop eval "'DEPTH_home=' + JSON.stringify({gradients:[...document.querySelectorAll('*')].filter(e=>/gradient/.test(getComputedStyle(e).backgroundImage)).length, grain:document.querySelectorAll('.grain,.grain-dark').length})"
  npx playwright-cli -s=qa-"$SLUG"-desktop eval "(function(){var p=document.querySelector('p');if(!p)return 'TYPE_home=no-p-found';var s=getComputedStyle(p);return 'TYPE_home=' + s.fontSize + '/' + s.fontWeight;})()"
) > /tmp/qa-desktop-"$SLUG".log 2>&1 &
DESKTOP_PID=$!

(
  npx playwright-cli -s=qa-"$SLUG"-mobile open "http://localhost:$PORT"
  npx playwright-cli -s=qa-"$SLUG"-mobile resize 390 844
  sleep 1
  npx playwright-cli -s=qa-"$SLUG"-mobile screenshot --filename=qa-screenshots/qa-mobile-top.webp --type webp
  # Horizontal overflow check — any element wider than the viewport breaks mobile layout.
  # Returns a JSON list of offending elements (tag + class + width). Empty list = no overflow.
  npx playwright-cli -s=qa-"$SLUG"-mobile eval "JSON.stringify((function(){var vw=document.documentElement.clientWidth;var out=[];var els=document.querySelectorAll('*');for(var i=0;i<els.length;i++){var r=els[i].getBoundingClientRect();if(r.right>vw+1){out.push({tag:els[i].tagName,cls:(els[i].className||'').toString().slice(0,80),right:Math.round(r.right),vw:vw});if(out.length>=10)break}}return out})())"
  npx playwright-cli -s=qa-"$SLUG"-mobile eval "window.scrollTo(0, document.body.scrollHeight / 2)"
  sleep 1
  npx playwright-cli -s=qa-"$SLUG"-mobile screenshot --filename=qa-screenshots/qa-mobile-mid.webp --type webp
  npx playwright-cli -s=qa-"$SLUG"-mobile eval "window.scrollTo(0, document.body.scrollHeight)"
  sleep 1
  npx playwright-cli -s=qa-"$SLUG"-mobile screenshot --filename=qa-screenshots/qa-mobile-bottom.webp --type webp
) > /tmp/qa-mobile-"$SLUG".log 2>&1 &
MOBILE_PID=$!

wait "$DESKTOP_PID" "$MOBILE_PID"
echo "--- desktop pass ---"; cat /tmp/qa-desktop-"$SLUG".log; rm -f /tmp/qa-desktop-"$SLUG".log
echo "--- mobile pass ---"; cat /tmp/qa-mobile-"$SLUG".log; rm -f /tmp/qa-mobile-"$SLUG".log

# Webfont check (deterministic, MANDATORY) — the site can render in Georgia/Helvetica while every
# source-level grep passes. Turbopack silently drops a remote `@import` from globals.css whenever
# the URL contains a comma (every real Google Fonts pairing URL has one), emitting no warning.
# `getComputedStyle().fontFamily` CANNOT catch it — it returns the DECLARED stack whether or not
# the face ever loaded, so grepping globals.css or reading computed style both come back clean on
# a broken build. font-check.mjs width-probes the rendered glyphs and inspects the built artefact.
# Prints FONT_CHECK=PASS or FONT_CHECK=FAIL. Step 4 gates on it: FAIL is a CRITICAL issue.
#
# NOTE: this and the next 8 checks are independent of each other (none reads another's output),
# so they run as ONE parallel batch launched right after the port-ready check ABOVE (before any
# screenshot work starts, so they overlap with all of it — see that block's own comment), not here
# and not one at a time. Read each check's own comment below for what it does; only the invocation
# moved — twice now: first into a batch, then earlier in the call so it overlaps screenshots too.

# Font uniqueness verification (STATIC, MANDATORY) — verifies the ARTIFACT, not the claim made to
# the design ledger at design-choice time. Parses the real next/font/google import in
# layout.tsx (which font is heading vs body, by its `--font-display-src`/`--font-body-src`
# variable), cross-checks it sanity-only against the built CSS's @font-face names, then scores it
# against data/design-fingerprints.json: a mismatch between what THIS build's own ledger record
# claimed and what actually shipped is a hard FAIL (bookkeeping-integrity issue — the fix is a
# one-line layout.tsx import swap or a corrected ledger record), and a shipped heading font that
# collides name-for-name with one of the last 8 OTHER builds is also a hard FAIL (never reuse a
# heading font — build/SKILL.md § How to pick fonts). A same-town body-font match is WARN-only for
# now (town-matching data quality unverified). Prints FONT_UNIQUENESS_CHECK=PASS/FAIL/SKIP — SKIP
# is normal on the first few runs across the whole system (nothing in the ledger yet to compare
# against) and is NOT a failure. Do NOT overrule a FAIL by eye — same reasoning as PHOTO_CHECK and
# HYPERUI_USAGE_CHECK: this proves a specific, named claim (which font shipped) against a specific,
# checkable fact, not that the typography looks good.

# Contrast check (COMPUTED, MANDATORY) — visual review CANNOT catch a contrast failure that
# doesn't look broken: white-on-gold at 2.9:1 reads as a handsome button and shipped through
# both a build check and a QA screenshot review. This serves out/ itself, walks EVERY page at
# desktop + mobile widths, composites translucent overlay layers from the rendered page, and
# applies the real WCAG threshold per element (3.0 large text, 4.5 otherwise).
# Prints CONTRAST_CHECK=PASS or CONTRAST_CHECK=FAIL. Step 4 gates on it: FAIL is CRITICAL.

# Token audit (STATIC, MANDATORY) — the rendered check above can only see what a resting page
# paints; semantic tokens (error text, toasts, validation banners) render on INTERACTION, so a
# missing or hand-edited token in that set ships invisibly past every screenshot. This verifies
# the full derive-palette.mjs token set exists in :root and every declared pair still passes.
# Prints TOKEN_CHECK=PASS or TOKEN_CHECK=FAIL. Step 4 gates on it: FAIL is CRITICAL.

# Hero video playback verification (BROWSER, MANDATORY) — added 2026-08-18 after the hero-video
# Verify gate in build/SKILL.md turned out to be self-graded prose (the builder checking its own
# work), the exact failure shape every OTHER gate in this file avoids by being a script. This
# actually loads the page in a browser and checks the <video> element is present, playing
# (currentTime advancing), has a working WCAG 2.2.2 pause control, and that a reduced-motion
# visitor never fetches the clip. Trusts status.md's own HERO_VIDEO=OK|FAIL record for whether a
# clip should exist at all (SKIP is correct and expected when HERO_VIDEO=FAIL — a legitimate
# poster-only degradation, not a finding) and only runs the real playback probe when one should.
# Prints HERO_VIDEO_PLAYBACK_CHECK=PASS/FAIL/SKIP. Step 4 gates on it: FAIL is CRITICAL.

# Photo verification (STATIC, MANDATORY) — every photo the site USES must be one gather positively
# cleared. Prints PHOTO_CHECK=PASS or PHOTO_CHECK=FAIL; Step 4 gates on it and FAIL is CRITICAL.
#
# WHY THIS IS A SCRIPT AND NOT LEFT TO YOUR EYES: on 2026-08-16 a build put a photograph of two
# people in horror-clown makeup with blood-spattered hands on the HOME PAGE of a Houston plumbing
# company. Round 1 of this very review screenshotted that home page, read the screenshots, and did
# not flag it; round 2 caught it 90 minutes in. Meanwhile gathered-content.md had said
# "(not yet verified)" next to that photo the entire time. The most expensive detector we own was
# doing a job a string comparison does in 40ms — and doing it unreliably.
# Run this, and do NOT overrule a FAIL because the photo "looks fine to you": the check is about
# whether the verdict was RECORDED, which is the thing that makes it auditable.
# NOTE the subshell + cd: this script resolves clients/<slug>/ from the REPO ROOT, unlike the
# checks above which take a path. The parentheses keep the cd from leaking into later steps.

# HyperUI usage/transplant-fidelity verification — DELETED 2026-08-19 (Jeff's explicit call).
# These two gates only ever proved a citation was technically valid (path exists, hash matches,
# structure similarity score) — never that the result looked good. Real evidence: cold-front-ac
# (2026-08-19) shipped 16 citations that PASSED both gates and still read as visually generic.
# The reference catalog, both gate scripts, and the lookup tool no longer exist in this repo.

# Copy/voice anti-repetition check (STATIC, MANDATORY, WARN-ONLY — gap 4 of 4 from Fable's
# sameness-gap spec, SAMENESS-04) — prints COPY_FINGERPRINT_CHECK=PASS/WARN/SKIP. Masks this
# client's own business name/town/owner/trade-noun/digit tokens out of its shipped prose, builds a
# 128-permutation MinHash sketch of the masked 5-word shingles, and compares it against the last 8
# prior builds' stored sketches in data/design-fingerprints.json. SKIP is normal (no built out/ yet,
# or no prior build's sketch exists yet to compare against — the system's own bootstrapping state)
# and is NOT a finding. This NEVER hard-fails, by design: masking has real, stated holes (a missed
# trade noun inflates an estimated overlap) and the threshold is an explicit placeholder pending
# more real client data — see the script's own header for the full reasoning and the real measured
# numbers it shipped with. A WARN line names which prior build(s) crossed the threshold and lists
# the actual shared phrases (re-derived fresh from that prior build's own files, only computed once
# the threshold trips) — report it verbatim, but do NOT fail the round on it alone.

# (All 11 gate-battery checks — including the Verify/QA freshness dedupe — already launched in the
# background right after the port-ready check above, overlapped with every screenshot phase below.
# Waited on and printed once, at the very end of this call, after subpages — see there.)

# (Mobile home-page pass now runs concurrently with desktop above — see Call 3.)

# ---- SUBPAGES ----------------------------------------------------------------
# The three screenshots above cover the HOME page only. Every other route gets its own
# desktop + mobile pass. Reviewing one page of four and reporting PASS is a silent failure:
# the report looks identical to a real one.
#
# Edit the LITERAL route words in the two loops below to match Step 2's ROUTES — drop any route
# this client doesn't have, add any extra rescue-parity routes.
#
# They are deliberately literal words, NOT `ROUTES="a b c"` plus `for R in $ROUTES`. That idiom is
# a silent one-iteration bug here: this Bash tool runs zsh, which does NOT word-split unquoted
# variables, so the loop runs ONCE with the whole string "services about contact", curls a URL
# that cannot exist, and every subpage goes unchecked while the block still looks like it ran.
# Verified 2026-08-15 on zsh 5.9.

# 1. HTTP status for every route, from the served export. A 404 here is a hard FAIL and
#    it is invisible in a screenshot of the home page.
#    NOTE: curl the .html artefact, NOT the extensionless path. `python3 -m http.server` has no
#    clean-URL handling, and a static export also emits a `services/` directory holding only RSC
#    payload .txt files — so `/services` 301s to `/services/` and then 404s HERE while serving
#    200 on Vercel and under `npx serve`. Reporting that 301/404 as a defect is a false red.
#    The extensionless paths are verified against the LIVE deploy by the deploy skill.
echo "--- ROUTE STATUS ---"
for R in "" services about contact; do
  F="${R:-index}"
  echo "/$R -> $(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/$F.html") (artefact $F.html)"
done

# 2. Desktop top + bottom, then mobile top + bottom, per route, with the same overflow check.
# Reuses the SAME two sessions opened in Call 3 (still open — only the final EXIT trap closes
# them), split into two independent per-viewport loops run concurrently rather than one loop that
# ping-pongs resize between desktop/mobile per route (Fable consult, 2026-08-18 — this loop over
# ~11 routes was measured as the single largest screenshot-cost block in the pipeline).
(
  npx playwright-cli -s=qa-"$SLUG"-desktop resize 1366 1000
  for R in services about contact; do
    npx playwright-cli -s=qa-"$SLUG"-desktop goto "http://localhost:$PORT/$R"
    sleep 1
    npx playwright-cli -s=qa-"$SLUG"-desktop screenshot --filename="qa-screenshots/qa-$R-top.webp" --type webp
    npx playwright-cli -s=qa-"$SLUG"-desktop eval "window.scrollTo(0, document.body.scrollHeight)"
    sleep 1
    npx playwright-cli -s=qa-"$SLUG"-desktop screenshot --filename="qa-screenshots/qa-$R-bottom.webp" --type webp
    # Word count — a route that exists but is a thin stub is a FAIL (build skill: no stub routes).
    npx playwright-cli -s=qa-"$SLUG"-desktop eval "'WORDS_$R=' + document.body.innerText.trim().split(/\s+/).length"
    # Title check — every page must have its OWN title, not the home page's.
    npx playwright-cli -s=qa-"$SLUG"-desktop eval "'TITLE_$R=' + document.title"
    # RENDERED depth (Fable consult, 2026-08-18: folded in here instead of a later separate call —
    # CSS declarations overstate reality, this counts what actually PAINTS). Step 4 gates on it.
    npx playwright-cli -s=qa-"$SLUG"-desktop eval "'DEPTH_$R=' + JSON.stringify({gradients:[...document.querySelectorAll('*')].filter(e=>/gradient/.test(getComputedStyle(e).backgroundImage)).length, grain:document.querySelectorAll('.grain,.grain-dark').length})"
    # Body typography, computed (CSS grep cannot see it) — folded in here for the same reason.
    npx playwright-cli -s=qa-"$SLUG"-desktop eval "(function(){var p=document.querySelector('p');if(!p)return 'TYPE_$R=no-p-found';var s=getComputedStyle(p);return 'TYPE_$R=' + s.fontSize + '/' + s.fontWeight;})()"
  done
) > /tmp/qa-subpages-desktop-"$SLUG".log 2>&1 &
SUBDESK_PID=$!

(
  npx playwright-cli -s=qa-"$SLUG"-mobile resize 390 844
  for R in services about contact; do
    npx playwright-cli -s=qa-"$SLUG"-mobile goto "http://localhost:$PORT/$R"
    sleep 1
    npx playwright-cli -s=qa-"$SLUG"-mobile screenshot --filename="qa-screenshots/qa-$R-mobile-top.webp" --type webp
    npx playwright-cli -s=qa-"$SLUG"-mobile eval "JSON.stringify((function(){var vw=document.documentElement.clientWidth;var out=[];var els=document.querySelectorAll('*');for(var i=0;i<els.length;i++){var r=els[i].getBoundingClientRect();if(r.right>vw+1){out.push({tag:els[i].tagName,cls:(els[i].className||'').toString().slice(0,80),right:Math.round(r.right),vw:vw});if(out.length>=10)break}}return out})())"
    npx playwright-cli -s=qa-"$SLUG"-mobile eval "window.scrollTo(0, document.body.scrollHeight)"
    sleep 1
    npx playwright-cli -s=qa-"$SLUG"-mobile screenshot --filename="qa-screenshots/qa-$R-mobile-bottom.webp" --type webp
  done
) > /tmp/qa-subpages-mobile-"$SLUG".log 2>&1 &
SUBMOB_PID=$!

wait "$SUBDESK_PID" "$SUBMOB_PID"
echo "--- subpages desktop ---"; cat /tmp/qa-subpages-desktop-"$SLUG".log; rm -f /tmp/qa-subpages-desktop-"$SLUG".log
echo "--- subpages mobile ---"; cat /tmp/qa-subpages-mobile-"$SLUG".log; rm -f /tmp/qa-subpages-mobile-"$SLUG".log

# 3. Navigation actually navigates. Anchor-only nav on a multi-page site is a FAIL.
# Reuses the -desktop session opened in Call 3 (Fable consult, 2026-08-18: this block still
# referenced the old pre-split bare `qa-"$SLUG"` session name after the desktop/mobile split above —
# that session was never opened, so this either errored "browser is not open" or silently spawned a
# third, untracked browser the EXIT trap never closes since it only tears down -desktop/-mobile).
npx playwright-cli -s=qa-"$SLUG"-desktop resize 1366 1000
npx playwright-cli -s=qa-"$SLUG"-desktop goto "http://localhost:$PORT/"
npx playwright-cli -s=qa-"$SLUG"-desktop eval "JSON.stringify(Array.from(document.querySelectorAll('nav a')).map(function(a){return a.getAttribute('href')}))"
# ------------------------------------------------------------------------------

# NOW reap the gate battery launched at the very start of this call (Fable consult, 2026-08-19) —
# every screenshot phase above (home + subpages, desktop + mobile) has been running concurrently
# with these 11 checks the whole time instead of waiting until now to even start them.
wait
for f in font-check font-uniqueness contrast token hero-video photo copy-fingerprint reviews nav-visibility design-intent; do
  echo "--- $f ---"; cat "/tmp/qa-gates-"$SLUG"/$f.log"
done
rm -rf "/tmp/qa-gates-"$SLUG""

# 4. Shrink the screenshots BEFORE you read them (MANDATORY — this is a context-budget fix).
# Measured 2026-08-16: this reviewer's context held 21 image blocks totalling 2.74 MB, which was
# 89.4% of everything in it (tool output 0.30 MB, text 0.03 MB). It then hit auto-compaction
# mid-review, TWICE in one build. Compaction mid-review is not merely slow — it can discard image
# content before you have written down what you saw, which is a correctness risk, not a cost one.
# PNG -> WebP q88 is perceptually free on flat UI screenshots; mobile shots are never resized.
( cd ../../.. && node scripts/shrink-screenshots.mjs "$SLUG" ) || true
# ------------------------------------------------------------------------------

# Teardown (server kill + browser close) is handled by the EXIT trap set at the top of this block,
# so it runs on every catchable exit path — a crash, timeout, or interrupt between `open` and here
# (a hard SIGKILL is the exception). Nothing to tear down explicitly anymore.
