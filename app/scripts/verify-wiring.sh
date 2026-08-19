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
chk "build skill references shadcn"      "grep -q 'shadcn' .claude/skills/build/SKILL.md"
chk "default-styling ban is stated"      "grep -q 'NEVER ship shadcn' .claude/skills/build/SKILL.md"

echo ""; echo "── 4. impeccable wired as brain AND judge ──"
chk "build invokes impeccable"           "grep -q 'skill=\"impeccable\"' .claude/skills/build/SKILL.md"
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

echo ""; echo "── 8. no dangling references to deleted sections ──"
chk "no dead § refs"                     "! grep -rqE '§ (Visual richness|Composition|Colour roles|Ground|Trade personality|Photo art direction|Section treatments|Design manifest|Typography variation)' .claude/skills/*/SKILL.md .claude/agents/*.md CLAUDE.md scripts/*.mjs"
chk "Bodoni not a code example"          "! grep -q 'Bodoni_Moda' .claude/skills/build/SKILL.md"
chk "consult typography not skipped"     "! grep -q 'Skip the .--design-system. font' .claude/skills/build/SKILL.md"

echo ""; printf "  ═══ %d passed, %d FAILED ═══\n\n" "$P" "$F"
exit $((F>0))
