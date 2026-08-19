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
