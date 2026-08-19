---
name: qa-fix
description: Fix issues found by the QA reviewer agent. Reads qa-report.md and fixes each issue listed.
argument-hint: [business-name]
effort: high
allowed-tools: Bash(npx *), Bash(cd *), Bash(kill *), Bash(sleep *), Bash(curl *), Read, Write, Edit, Glob, Grep
---

# Fix QA Issues for $ARGUMENTS

The independent QA reviewer found issues with this site. Read `prompts/lessons/build.md` first (the failure modes and their canonical fixes), then read their report and fix every issue.

## Step 1: Read the QA report
Read `clients/$ARGUMENTS/data/qa-report.md`.

## Step 2: Read the gathered content
Read `clients/$ARGUMENTS/data/gathered-content.md` so you understand what the correct content should be.

## Step 2b: PLAN THE FIX PASS BEFORE TOUCHING A FILE (context discipline — mandatory)

**Measured 2026-08-19, twice, on real builds: the authoring phase holds 0 compactions and 0
self-re-reads, and then the FIX phase blows both targets — 4 compactions and 25 self-re-reads on
one run.** Fixing is where context dies, because the naive loop is "read whole file → make one edit
→ next finding → read the same whole file again". A route `page.tsx` is 6-10K tokens, so ten
findings across three files can re-load the entire context window. Then it compacts, the design
brief is summarised away, and the remaining fixes are made by a model that no longer remembers the
design — which is how a fix round makes a site *worse*.

**Be honest about the constraint:** the `Edit` tool requires a prior `Read` of that file in this
session, and after a compaction that read is gone. So "never re-read" is not followable. The
followable rule is **read narrowly, once per file, and never come back**:

1. **Group every finding in the report BY FILE first.** Write the grouping down before editing.
   You are doing one pass per file, not one pass per finding.
2. **For each file: ONE read, then ALL of its edits, then never open it again.** Use
   `offset`/`limit` around the reported line numbers rather than reading the whole file — the QA
   report gives you line numbers precisely so you can.
3. **Use the mechanical fixers instead of hand-editing** — they need no read at all:
   - `node scripts/fix-dashes.mjs $ARGUMENTS` — em/en-dashes
   - `node scripts/fix-img-dims.mjs $ARGUMENTS` — missing `<img>` width/height
   - `node scripts/ship-scan.mjs clients/$ARGUMENTS/site --fix` — comment/artefact strip
   Run these FIRST and re-read the report; anything they fixed needs no manual pass.
4. **After ANY compaction, run `node scripts/verify-design-intent.mjs $ARGUMENTS --brief-only`**
   (~8 lines) to reload the design brief. Do NOT re-read generated code to remember what was built —
   that is the exact behaviour that caused the spiral.
5. **Never re-read a file to "check your work."** `npx next build` in Step 4 and the independent QA
   reviewer are what verify the fix. Re-reading to self-verify is pure context cost.

## Step 3: Fix every issue

Work through the QA report systematically:

### Critical issues (must fix ALL)
- Fix every critical issue listed. These block deployment.
- Reference the line numbers from the QA report.

### Minor issues (fix ALL unless genuinely cosmetic)
- Fix these too. The QA reviewer flagged them for a reason.

### Common fixes
- **Wrong content**: Cross-reference gathered-content.md, update the page the reviewer named. The QA report names a route (`services/page.tsx line 88`) because these sites are multi-page — fix it there, and check whether the same wrong fact repeats on the other routes or in `_components/` before you close the issue.
- **Missing photos**: Check gathered-content.md for photo URLs that weren't used
- **Broken images**: Verify with `curl -sL -o /dev/null -w "%{http_code} %{size_download}" "URL"` - remove if truly broken, keep if just a headless browser issue
- **fontFamily overrides**: Remove any `style={{ fontFamily: ... }}` from every route file and the shared chrome (`grep -rn 'fontFamily' src/app --include='*.tsx'`)
- **Bad grid layout**: Switch from `grid grid-cols-X` to `flex flex-wrap justify-center`
- **Missing Google Maps**: Add CID-based embed from gathered-content.md
- **Missing contact section**: build `_components/ContactForm.tsx` posting to `/api/preview/${slug}/contact` per build/SKILL.md's § Contact form (2026-08-18 spec) — never `mailto:`, retired for silent-failure reasons the skill explains. The endpoint's own orphan-queue path handles the no-email case; there is no separate no-email branch to build anymore.

## Step 4: Verify build
```bash
cd clients/$ARGUMENTS/site
npx next build
```

If the build fails, fix the errors and rebuild.

Do NOT re-run QA yourself. The independent QA reviewer will be spawned again to verify your fixes.
