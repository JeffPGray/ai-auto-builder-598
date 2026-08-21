#!/usr/bin/env bash
# verify-wiring.sh — assert every design/quality mechanism is ACTUALLY reachable at build time.
#
# WHY: on 2026-08-19 build/SKILL.md was found instructing the model to call
# Skill(skill="anti-ai-slop") at three places while its own frontmatter forbade the Skill tool.
# That skill had therefore never run. The same defect was then found in qa-reviewer.md, in a fix
# written the same hour. Wiring failures are silent by construction — nothing errors, the
# instruction is simply never executable. Spot-checking does not catch them. This does.
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
P=0; F=0
ok(){ printf "  \033[32mPASS\033[0m  %s\n" "$1"; P=$((P+1)); }
no(){ printf "  \033[31mFAIL\033[0m  %s\n" "$1"; F=$((F+1)); }
chk(){ if eval "$2" >/dev/null 2>&1; then ok "$1"; else no "$1"; fi; }

echo ""; echo "── 1. Skill tool reachable everywhere it is invoked ──"
for f in .claude/skills/*/SKILL.md .claude/agents/*.md; do
  n=$(basename "$(dirname "$f")")/$(basename "$f")
  calls=$(grep -cE 'Skill\(skill=' "$f" 2>/dev/null); calls=${calls:-0}
  [ "$calls" -eq 0 ] && continue
  if ! grep -q "^allowed-tools:" "$f"; then ok "$n ($calls calls, unrestricted)"
  elif grep -m1 "^allowed-tools:" "$f" | grep -q "Skill"; then ok "$n ($calls calls, permitted)"
  else no "$n calls Skill() $calls x but allowed-tools FORBIDS it"; fi
done

echo ""; echo "── 1b. AGENT frontmatter uses the right key (tools:, not allowed-tools:) ──"
for f in .claude/agents/*.md; do
  n=$(basename "$f")
  if grep -q "^allowed-tools:" "$f"; then
    no "$n uses allowed-tools: — that is the SKILL key; agents use tools: and this one is IGNORED"
  elif grep -q "^tools:" "$f"; then
    if grep -qE 'Skill\(skill=' "$f" && ! grep -m1 "^tools:" "$f" | grep -q "Skill"; then
      no "$n invokes Skill() but tools: does not list Skill"
    else ok "$n tools: declared correctly"; fi
  else ok "$n (no tools: key — unrestricted)"; fi
done

echo ""; echo "── 2. Skills invoked actually exist on disk ──"
for s in $(grep -rhoE 'Skill\(skill="[a-z-]+"' .claude/skills .claude/agents 2>/dev/null | sed 's/.*"\(.*\)"/\1/' | sort -u); do
  if [ -d "$HOME/.claude/skills/$s" ] || [ -d ".claude/skills/$s" ] || find "$HOME/.claude/plugins" -maxdepth 5 -type d -name "$s" 2>/dev/null | grep -q .; then
    ok "skill '$s' exists"; else no "skill '$s' INVOKED BUT NOT INSTALLED"; fi
done

echo ""; echo "── 3. shadcn/ui vendored in the template ──"
chk "components.json present"            "test -f templates/trade-site/components.json"
chk "cn() util present"                  "test -f templates/trade-site/src/lib/utils.ts"
for c in accordion dialog sheet dropdown-menu; do
  chk "primitive: $c"                    "test -f templates/trade-site/src/app/_components/ui/$c.tsx"; done
chk "cssVariables:false (no slate leak)" "grep -q '\"cssVariables\": false' templates/trade-site/components.json"
chk "tailwindcss-animate in config"      "grep -q 'tailwindcss-animate' templates/trade-site/tailwind.config.ts"
chk "accordion keyframes survive"        "grep -q 'accordion-down' templates/trade-site/tailwind.config.ts"
for d in clsx tailwind-merge class-variance-authority lucide-react tailwindcss-animate; do
  chk "dep: $d"                          "grep -q '\"$d\"' templates/trade-site/package.json"; done
chk "build skill references shadcn"      "grep -rq 'shadcn' .claude/skills/build --include='*.md'"
chk "default-styling ban is stated"      "grep -rq 'NEVER ship shadcn' .claude/skills/build --include='*.md'"

echo ""; echo "── 4. impeccable wired as brain AND judge ──"
chk "build invokes impeccable"           "grep -rq 'skill=\"impeccable\"' .claude/skills/build --include='*.md'"
chk "QA invokes impeccable"              "grep -q 'skill=\"impeccable\"' .claude/agents/qa-reviewer.md"

echo ""; echo "── 5. trade data reaches the build (CSV -> core -> generator -> printed) ──"
chk "Typography Pool column exists"      "head -1 .claude/skills/ui-ux-pro-max/data/trade-identities.csv | grep -q 'Typography Pool'"
chk "core.py output_cols includes it"    "grep -q 'Typography Pool' .claude/skills/ui-ux-pro-max/scripts/core.py"
chk "generator maps type_pool"           "grep -q 'type_pool' .claude/skills/ui-ux-pro-max/scripts/design_system.py"
chk "uniform-run cap in every seed"      "[ \$(grep -c 'HARD CAP' .claude/skills/ui-ux-pro-max/data/trade-identities.csv) -ge 9 ]"

echo ""; echo "── 6. scripts run and behave (live execution, not grep) ──"
chk "derive-palette: saturated ground"   "node scripts/derive-palette.mjs '#204080' --harmony split --character deep --ground saturated --ground-hue 265 | grep -q 'ground=saturated'"
chk "derive-palette: contrast passes"    "! node scripts/derive-palette.mjs '#204080' --harmony split --character deep --ground saturated --ground-hue 265 | grep -q '^  FAIL'"
chk "dark chroma raised (not grey)"      "grep -q 'C: 0.055' scripts/derive-palette.mjs"
chk "design-ledger scoped to town"       "grep -q 'SAME TOWN' scripts/design-ledger.mjs"
chk "cross-town reuse is INFO not FAIL"  "grep -q 'FONT_LEDGER=INFO' scripts/design-ledger.mjs"
chk "verify-design-intent executes"      "node --check scripts/verify-design-intent.mjs"
chk "build-metrics executes"             "node --check scripts/build-metrics.mjs"
chk "qa-capture.sh syntax"               "bash -n scripts/qa-capture.sh"

echo ""; echo "── 7. consult output is trade-correct (live) ──"
OUT=$(python3 .claude/skills/ui-ux-pro-max/scripts/search.py "HVAC heating cooling contractor bold" --design-system -p T 2>/dev/null)
chk "routes to Trade Service"            "echo \"\$OUT\" | grep -qi 'trade'"
chk "TYPOGRAPHY POOL printed"            "echo \"\$OUT\" | grep -q 'TYPOGRAPHY POOL'"
chk "no fashion/luxury style for trade"  "! echo \"\$OUT\" | grep -qiE 'STYLE:.*(Exaggerated|Fashion|Luxury|Editorial)'"
chk "no compliance style as identity"    "! echo \"\$OUT\" | grep -qi 'STYLE:.*Accessible'"
chk "TRADE IDENTITY block printed"       "echo \"\$OUT\" | grep -q 'TRADE IDENTITY'"

echo ""; echo "── 7b. fix-phase context discipline (where the metrics actually break) ──"
chk "qa-fix groups findings by file"     "grep -q 'BY FILE' .claude/skills/qa-fix/SKILL.md"
chk "qa-fix mandates one read per file"  "grep -q 'ONE read, then ALL of its edits' .claude/skills/qa-fix/SKILL.md"
chk "qa-fix points at mechanical fixers" "grep -q 'fix-dashes.mjs' .claude/skills/qa-fix/SKILL.md"
chk "qa-fix has post-compaction reload"  "grep -q 'brief-only' .claude/skills/qa-fix/SKILL.md"
for m in fix-dashes fix-img-dims ship-scan verify-design-intent; do
  chk "fixer exists: $m.mjs"             "test -f scripts/$m.mjs"; done

echo ""; echo "── 7c. design gates that catch what prose could not ──"
chk "monotone-ground gate exists"        "grep -q 'MONOTONE GROUND RUN' scripts/richness-check.mjs"
chk "monotone gate catches mono-navy"    "node scripts/richness-check.mjs clients/cold-front-ac/site 2>&1 | grep -q '\[monotone\]'"
chk "shadcn-ignored gate exists"         "grep -q 'SHADCN PRIMITIVES' scripts/richness-check.mjs"
chk "shadcn gate catches non-use"        "node scripts/richness-check.mjs clients/cold-front-ac/site 2>&1 | grep -q '\[primitives\]'"
chk "canvas decision rule is executable" "grep -rq 'CANVAS_MODE=' .claude/skills/build --include='*.md'"
chk "NEUTRAL-CANVAS is the trade default" "grep -rq 'NEUTRAL-CANVAS is the default' .claude/skills/build --include='*.md'"
chk "saturated no longer 'usually right'" "! grep -rq 'usually the right answer for a trade site' .claude/skills/build --include='*.md'"
chk "reset script clears fingerprints"   "grep -q 'design-fingerprints' scripts/reset-client-design.mjs"
chk "canonical qa-serve strips prefix"   "grep -q 'klaudius' scripts/qa-serve.mjs"

echo ""; echo "── 7d. gate verdicts are LOAD-BEARING (a failing gate cannot be walked past) ──"
# Every assertion here maps to a measured 2026-08-19 failure where a gate ran, produced a correct
# answer, and the build carried on anyway. These are the mechanisms that close each one.
chk "qa-capture serves via qa-serve"     "grep -q 'qa-serve.mjs' scripts/qa-capture.sh"
chk "qa-capture no longer uses http.server" "! grep -qE '^\\s*python3 -m http.server' scripts/qa-capture.sh"
chk "qa-capture kills Call 2's server"   "grep -q 'pkill -f \"http.server \$STALE_PORT' scripts/qa-capture.sh"
chk "serve-sanity gate exists"           "grep -q 'SERVE_SANITY_CHECK=' scripts/qa-capture.sh"
chk "serve-sanity aborts on 404 assets"  "grep -A8 'ASSET_CODE\" != \"200\"' scripts/qa-capture.sh | grep -q 'exit 1'"
# Precise: the CARRY is the `echo "X=PASS (carried from Verify..."` lines that synthesised a verdict
# without running the gate. The block comment explaining WHY they were removed necessarily quotes
# that same string, and must not fail this check — same discipline as the Bodoni assertion above.
chk "verify-carry removed (no fake PASS)" "! grep -qE '^[[:space:]]*echo \"[A-Z_]+=PASS \\(carried' scripts/qa-capture.sh"
chk "the five carried gates really run"   "[ \$(grep -cE '^(node|\\( cd) .*(font-check|contrast-check|verify-reviews|verify-nav-visibility)' scripts/qa-capture.sh) -ge 5 ]"
chk "hero-video always emits a verdict"  "grep -q 'uncaughtException' scripts/verify-hero-video.mjs"
chk "hero-video focuses sr-only control" "grep -q 'btn.focus()' scripts/verify-hero-video.mjs"
chk "gate registry exists"               "test -f scripts/lib/gates.mjs"
chk "registry: every gate has a verdict re" "node -e 'import(\"./scripts/lib/gates.mjs\").then(m=>process.exit(m.GATES.every(g=>g.verdict instanceof RegExp)?0:1))'"
chk "registry: claims map to real gates"  "node -e 'import(\"./scripts/lib/gates.mjs\").then(m=>process.exit(m.GATES.filter(g=>g.claim).length>=5?0:1))'"
chk "runGate captures to file not pipe"   "grep -q 'stdio:\\s*\\[.ignore., fd, fd\\]' scripts/lib/gates.mjs"
chk "runGate flags exit/verdict mismatch" "grep -q \"verdict: 'INTEGRITY'\" scripts/lib/gates.mjs"
chk "runGate flags a missing verdict"     "grep -q \"verdict: 'MISSING'\" scripts/lib/gates.mjs"
chk "copy-fingerprint no truncating exit" "! grep -qE '^process.exit\\(0\\);' scripts/copy-fingerprint-check.mjs"
for m in run-gates reconcile-claims verify-fix; do
  chk "mechanism executes: $m.mjs"       "node --check scripts/$m.mjs"; done
chk "run-gates prints one GATES= verdict" "grep -q 'GATES=' scripts/run-gates.mjs"
chk "reconciler fails on contradiction"   "grep -q 'CONTRADICTION' scripts/reconcile-claims.mjs"
chk "reconciler fails on stale claim"     "grep -q 'STALE-CLAIM' scripts/reconcile-claims.mjs"
chk "reconciler fails on unverifiable"    "grep -q 'UNVERIFIED' scripts/reconcile-claims.mjs"
chk "verify-fix detects a non-fix"        "grep -q 'NOT-FIXED' scripts/verify-fix.mjs"
chk "verify-fix detects a regression"     "grep -q 'REGRESSED' scripts/verify-fix.mjs"
chk "verify-fix names unadjudicated"      "grep -q 'UNADJUDICATED' scripts/verify-fix.mjs"
chk "dispatch sweeps qa-serve too"        "grep -q 'qa-serve' scripts/dispatch-build.sh"
chk "dispatch sweeps playwright at start" "grep -q 'pw_sweep_stale' scripts/dispatch-build.sh"
chk "worker child env is set"            "grep -q 'CLAUDE_WORKER_CHILD=1' scripts/dispatch-build.sh"
chk "stage-timer exists"                 "test -f scripts/stage-timer.mjs"
chk "write-once-check exists"            "test -f scripts/write-once-check.mjs"
chk "pre-qa-gates wraps run-gates"       "grep -q 'run-gates.mjs' scripts/pre-qa-gates.sh"
chk "build skill is a dispatcher"        "test $(wc -l < .claude/skills/build/SKILL.md) -lt 200"
chk "build stages split"                 "test -f .claude/skills/build/stages/author.md -a -f .claude/skills/build/stages/verify.md"
chk "QA gates before screenshots"        "grep -q 'pre-qa-gates.sh' CLAUDE.md"
chk "QA cap is 2 rounds"                 "grep -q 'Maximum 2 QA iterations' CLAUDE.md"
chk "blog spawn is sonnet"               "grep -q 'model=\"sonnet\"' .claude/skills/build/stages/author.md"

echo ""; echo "── 8. no dangling references to deleted sections ──"
chk "no dead § refs"                     "! grep -rqE '§ (Visual richness|Composition|Colour roles|Ground|Trade personality|Photo art direction|Section treatments|Design manifest|Typography variation)' .claude/skills/*/SKILL.md .claude/agents/*.md CLAUDE.md scripts/*.mjs"
# Precise: Bodoni must not appear as an IMPORT/code example. Mentioning it in the historical
# explanation of why it was removed is correct and must not fail this check.
chk "Bodoni not a code example"          "! grep -qE '^\\s*(import|const).*Bodoni_Moda' .claude/skills/build/SKILL.md"
chk "consult typography not skipped"     "! grep -q 'Skip the .--design-system. font' .claude/skills/build/SKILL.md"

echo ""; echo "── 9. GENERIC reachability (derived, not enumerated) ──"
# Everything above this line is an ENUMERATION: 62 assertions naming the specific wires that were
# found broken by hand on 2026-08-19. That is its strength (it asserts real BEHAVIOUR — it runs
# derive-palette and greps the output, runs richness-check against a real client and proves the
# gate fires) and its weakness (a wire added tomorrow is unprotected until somebody remembers to
# write assertion #63).
#
# verify-wiring-generic.mjs closes that gap. It enumerates nothing: it parses every skill and
# agent, extracts the tools/scripts/flags/sections each body actually instructs, and asserts the
# frontmatter and the filesystem can satisfy them. A brand-new skill is covered the moment it
# exists. Its own self-test (scripts/verify-wiring-generic.test.mjs) proves it catches all five
# 2026-08-19 failure SHAPES when they reappear under names it has never seen.
if node scripts/verify-wiring-generic.mjs; then
  ok "generic reachability checks (see output above)"
else
  no "generic reachability FAILED — see the itemised output above; each names file:line and the fix"
fi

echo ""; echo "── 10. Rule-corpus CONSISTENCY (contradictions, not reachability) ──"
# Sections 1-9 ask "can this instruction execute?". This asks a different question: "do two
# instructions tell the model opposite things?" — the failure mode where every wire is live, every
# gate is reachable, and the model still does the wrong thing because the nearest rule won.
# Reachability checks pass cleanly on a file that names FULL-TINT the default in one section and
# NEUTRAL-CANVAS the default in another; only this catches that.
if node scripts/verify-consistency.mjs; then
  ok "no rule contradictions detected"
else
  no "rule CONTRADICTIONS found — see the itemised output above; each names both sides with file:line"
fi

echo ""; printf "  ═══ %d passed, %d FAILED ═══\n\n" "$P" "$F"
exit $((F>0))
