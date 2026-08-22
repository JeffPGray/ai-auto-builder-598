#!/usr/bin/env node
/**
 * font-uniqueness-check.mjs <slug>
 *
 * Verifies the ARTIFACT (what actually shipped), not the claim made to the ledger at
 * design-choice time — the same posture hyperui-usage-check.mjs takes toward real vendored
 * citations over "informed by" prose. design-ledger.mjs's `check`/`record` font-ledger flags
 * (--heading-font/--body-font/--town) run BEFORE a single page.tsx exists, off whatever the build
 * intends to use; this script runs AFTER `/build`, parses the real `layout.tsx` for the
 * `next/font/google` fonts that actually got wired up, and re-verifies uniqueness against that —
 * catching the case where the design-choice-time claim and the shipped code drifted apart (a
 * typo, a copy-paste from the wrong client, a last-minute font swap that never made it back to
 * the ledger).
 *
 * Extraction:
 *   1. Parse `clients/<slug>/site/src/app/layout.tsx` for the `next/font/google` import, split the
 *      imported identifiers, and determine heading vs body by which identifier's `next/font`
 *      config object sets `variable: "--font-display-src"` vs `variable: "--font-body-src"` — the
 *      real convention, confirmed against clients/the-woodlands-plumbing-and-air/site/src/app/
 *      layout.tsx before writing this regex. Falls back to import order (first = heading, second
 *      = body) with a printed note if that convention isn't found at all.
 *   2. Cross-checks the claim against the built artefact: does a font by that name actually appear
 *      in an `@font-face` block anywhere under `clients/<slug>/site/out/` (any nested .css file)?
 *      This is a WARN-only sanity signal, not a second source of truth — step 1's source-level
 *      extraction is what the rest of this script scores against.
 *   3. Scans every other client layout.tsx and sibling site-data.ts directly, so
 *      a same-town collision still fails when either client is absent from the fingerprint ledger.
 *
 * Scoring, against data/design-fingerprints.json:
 *   - Same-slug claim-vs-artifact drift (this build's own prior ledger record claimed a different
 *     heading/body font than what actually shipped) — hard FAIL. Bookkeeping-integrity issue, not
 *     a judgment call: whatever the ledger says was decided is supposed to be what got built.
 *   - Heading-font reuse — hard FAIL ONLY on SAME-TOWN collision against sibling client source or
 *     the last 8 OTHER records (same rule as design-ledger.mjs). Cross-town reuse is INFO only —
 *     forcing a re-pick produced Bodoni on HVAC (2026-08-19).
 *   - Same-town body-font reuse against the last 8 OTHER records — WARN only.
 *
 * Prints FONT_UNIQUENESS_CHECK=PASS|FAIL|SKIP. SKIP fires when there is nothing real to compare
 * against yet — no other ledger records, or no records (including this slug's own) carry font
 * fields — mirroring hyperui-usage-check.mjs's SKIP-when-reference-set-absent posture: the first
 * few runs across the whole system must not fail on an empty/sparse history.
 *
 * On PASS, the EXTRACTED (verified-real, not claimed) heading/body font values are written back
 * onto this slug's own record in data/design-fingerprints.json — read record, mutate in place,
 * write back, fail-open on a corrupt ledger, never fabricate a stub record for a slug that
 * doesn't have one yet. Same pattern hyperui-usage-check.mjs already uses for its own citation
 * write-back; see that script's comments for why it fails open and doesn't fabricate stubs.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withFileLock } from './lib/file-lock.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FINGERPRINT_LEDGER = join(REPO_ROOT, 'data', 'design-fingerprints.json');
const LOOKBACK = 8;

const slug = process.argv[2];
if (!slug) {
  console.error('usage: font-uniqueness-check.mjs <slug>');
  process.exit(2);
}

// Same normalisation as design-ledger.mjs's font-ledger check — kept as a local copy rather than
// a shared import, matching this project's house style of self-contained gate scripts (see
// hyperui-usage-check.mjs, contrast-check.mjs: none of the deterministic gates import from a
// shared lib). Lowercase, underscores (the next/font/google import identifier form) become
// spaces, quotes stripped, whitespace collapsed.
function normFont(s) {
  if (!s) return null;
  const n = String(s).toLowerCase().replace(/_/g, ' ').replace(/["'`]/g, '').replace(/\s+/g, ' ').trim();
  return n || null;
}

// ── Step 1: extract the REAL fonts from the shipped layout.tsx ──
const layoutPath = join(REPO_ROOT, 'clients', slug, 'site', 'src', 'app', 'layout.tsx');
if (!existsSync(layoutPath)) {
  console.log(`FONT_UNIQUENESS_CHECK=FAIL — ${layoutPath} does not exist (has this client been built?)`);
  process.exit(1);
}
const layoutSrc = readFileSync(layoutPath, 'utf8');

const importMatch = layoutSrc.match(/import\s*\{([^}]+)\}\s*from\s*["']next\/font\/google["']/);
if (!importMatch) {
  console.log(`FONT_UNIQUENESS_CHECK=FAIL — no \`next/font/google\` import found in ${layoutPath}`);
  process.exit(1);
}
const identifiers = importMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
if (identifiers.length < 1) {
  console.log(`FONT_UNIQUENESS_CHECK=FAIL — \`next/font/google\` import in ${layoutPath} has no font identifiers`);
  process.exit(1);
}

// For each imported identifier, find its config object (`Identifier({ ... })`) and read the
// `variable:` it sets, to decide heading vs body.
function roleForIdentifier(source, identifier) {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}\\(\\{([\\s\\S]*?)\\}\\)`);
  const m = source.match(re);
  if (!m) return null;
  const config = m[1];
  if (/variable\s*:\s*["'`]--font-display-src["'`]/.test(config)) return 'heading';
  if (/variable\s*:\s*["'`]--font-body-src["'`]/.test(config)) return 'body';
  return null;
}

function headingFontFromLayout(source) {
  const imported = source.match(/import\s*\{([^}]+)\}\s*from\s*["']next\/font\/google["']/);
  if (!imported) return null;
  const ids = imported[1].split(',').map((s) => s.trim()).filter(Boolean);
  const headingId = ids.find((id) => roleForIdentifier(source, id) === 'heading') || ids[0];
  return headingId ? headingId.replace(/_/g, ' ') : null;
}

let extractedHeading = null;
let extractedBody = null;
let usedFallbackOrder = false;
for (const id of identifiers) {
  const role = roleForIdentifier(layoutSrc, id);
  const display = id.replace(/_/g, ' ');
  if (role === 'heading') extractedHeading = display;
  else if (role === 'body') extractedBody = display;
}
if (!extractedHeading && !extractedBody) {
  // Neither `--font-display-src` nor `--font-body-src` was found anywhere — fall back to import
  // order (first = heading, second = body), which is the convention every real client file
  // observed so far also happens to follow. Not a FAIL; the variable-based read is just the
  // more precise signal when it's available.
  usedFallbackOrder = true;
  extractedHeading = identifiers[0] ? identifiers[0].replace(/_/g, ' ') : null;
  extractedBody = identifiers[1] ? identifiers[1].replace(/_/g, ' ') : null;
  console.log(
    `FONT_UNIQUENESS_NOTE — no --font-display-src/--font-body-src variable found in ${layoutPath}; fell back to import order (heading="${extractedHeading}", body="${extractedBody}")`
  );
}

// ── Step 2: cross-check against the built artefact (WARN-only sanity signal) ──
const outRoot = join(REPO_ROOT, 'clients', slug, 'site', 'out');
const cssFiles = [];
function walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (extname(name) === '.css') cssFiles.push(p);
  }
}
walk(outRoot);

if (cssFiles.length) {
  const cssText = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
  const shipped = new Set();
  for (const faceMatch of cssText.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const nameMatch = faceMatch[1].match(/font-family\s*:\s*([^;]+);?/);
    if (nameMatch) shipped.add(nameMatch[1].trim().replace(/^["']|["']$/g, ''));
  }
  const shippedNorm = [...shipped].map(normFont);
  for (const [role, claimed] of [['heading', extractedHeading], ['body', extractedBody]]) {
    if (!claimed) continue;
    if (!shippedNorm.includes(normFont(claimed))) {
      console.log(
        `FONT_UNIQUENESS_WARNING — claimed ${role} font "${claimed}" was not found in any @font-face block under ${outRoot} (sanity cross-check only, source-level extraction is still the primary signal)`
      );
    }
  }
} else {
  console.log(`FONT_UNIQUENESS_NOTE — no built CSS found under ${outRoot}; skipping artefact cross-check`);
}

// ── Load the ledger (fail-open on corrupt, same posture as design-ledger.mjs / hyperui-usage-check.mjs) ──
let ledger = [];
if (existsSync(FINGERPRINT_LEDGER)) {
  try {
    const parsed = JSON.parse(readFileSync(FINGERPRINT_LEDGER, 'utf8'));
    if (Array.isArray(parsed)) ledger = parsed;
  } catch {
    console.log('FONT_UNIQUENESS_NOTE — design-fingerprints.json unreadable; treating as empty (fail-open)');
  }
}

const own = ledger.find((r) => r.slug === slug);
const priors = ledger.filter((r) => r.slug !== slug).slice(0, LOOKBACK);
const priorsWithHeadingClaim = priors.filter((r) => r.headingFont);

// The ledger is not the whole client set. Lux had no fingerprint record, so its Fraunces collision
// with another Frisco client was invisible. Read the town and heading font directly from every
// sibling client, including an own-city fallback when this slug's ledger row is absent or incomplete.
function cityFromSiteData(clientSlug) {
  const siteDataPath = join(
    REPO_ROOT, 'clients', clientSlug, 'site', 'src', 'app', '_components', 'site-data.ts'
  );
  if (!existsSync(siteDataPath)) return null;
  return (readFileSync(siteDataPath, 'utf8').match(/\bcity\s*:\s*"([^"]+)"/) || [])[1] || null;
}

const ownTown = (own && own.town) || cityFromSiteData(slug);
const siblingHeadingCollisions = [];
const clientsDir = join(REPO_ROOT, 'clients');
if (ownTown && extractedHeading && existsSync(clientsDir)) {
  for (const entry of readdirSync(clientsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === slug) continue;
    const siblingLayoutPath = join(clientsDir, entry.name, 'site', 'src', 'app', 'layout.tsx');
    if (!existsSync(siblingLayoutPath)) continue;
    const siblingTown = cityFromSiteData(entry.name);
    if (!siblingTown || normFont(siblingTown) !== normFont(ownTown)) continue;
    const siblingHeading = headingFontFromLayout(readFileSync(siblingLayoutPath, 'utf8'));
    if (siblingHeading && normFont(siblingHeading) === normFont(extractedHeading)) {
      siblingHeadingCollisions.push({
        slug: entry.name,
        town: siblingTown,
        headingFont: siblingHeading,
      });
    }
  }
}

// Nothing comparable exists yet anywhere in the system (no own claim to check drift against, and
// no prior record carries a font field to check reuse against) — SKIP rather than manufacture a
// FAIL out of an empty/sparse history.
const ownHasFontClaim = Boolean(own && (own.headingFont || own.bodyFont));
const priorsHaveFontData = priors.some((r) => r.headingFont || r.bodyFont);
if (!ownHasFontClaim && !priorsHaveFontData && siblingHeadingCollisions.length === 0) {
  console.log(
    `FONT_UNIQUENESS_CHECK=SKIP (no comparable font data in data/design-fingerprints.json or same-town sibling client sources yet — no other records carry font fields, and ${slug} has no prior font claim to check drift against)`
  );
  process.exit(0);
}

let hardFail = false;

for (const collision of siblingHeadingCollisions) {
  console.log(
    `FONT_UNIQUENESS_CHECK=FAIL — shipped heading font "${extractedHeading}" collides with ${collision.slug}'s shipped heading font "${collision.headingFont}" in the SAME TOWN (${ownTown}). Neighbouring owners can see both sites — swap the import in layout.tsx for a different shortlist entry.`
  );
  hardFail = true;
}

// ── Claim-vs-artifact drift (same slug, own prior record) — hard FAIL ──
if (own) {
  if (own.headingFont && extractedHeading && normFont(own.headingFont) !== normFont(extractedHeading)) {
    console.log(
      `FONT_UNIQUENESS_CHECK=FAIL — claim-vs-artifact drift: ${slug}'s ledger record claims headingFont="${own.headingFont}" but shipped layout.tsx uses "${extractedHeading}". Update the ledger claim (or fix the build) so they agree.`
    );
    hardFail = true;
  }
  if (own.bodyFont && extractedBody && normFont(own.bodyFont) !== normFont(extractedBody)) {
    console.log(
      `FONT_UNIQUENESS_CHECK=FAIL — claim-vs-artifact drift: ${slug}'s ledger record claims bodyFont="${own.bodyFont}" but shipped layout.tsx uses "${extractedBody}". Update the ledger claim (or fix the build) so they agree.`
    );
    hardFail = true;
  }
}

// ── Heading-font reuse — hard FAIL ONLY on a SAME-TOWN collision ──
//
// SCOPED 2026-08-19 to match design-ledger.mjs, which was scoped earlier the same day. The two
// gates adjudicate ONE defect and had drifted apart: design-ledger fires REUSE only same-town and
// prints INFO cross-town ("NOT a failure — keep the font"), while this file still hard-FAILed on
// any collision with the last 8 builds regardless of town — and its own error text cited the
// section that says the opposite. A build that correctly KEPT the consult's cross-town pairing was
// therefore passed at build time and hard-FAILed at QA, told to swap fonts. That forced re-pick is
// precisely what pushed a build onto Bodoni Moda, a Vogue fashion didone, on a Texas HVAC
// contractor. Uniqueness only has value where a prospect could see both sites.
if (extractedHeading) {
  const sameFont = priorsWithHeadingClaim.filter((r) => normFont(r.headingFont) === normFont(extractedHeading));
  const collision = ownTown
    ? sameFont.find((r) => r.town && normFont(r.town) === normFont(ownTown))
    : null;
  if (!collision && sameFont.length) {
    console.log(
      `FONT_UNIQUENESS_INFO — heading font "${extractedHeading}" is also used by ${sameFont.map((r) => r.slug).join(', ')}, but in a different town. NOT a failure: no prospect sees both sites, and forcing a re-pick here is what produced a fashion didone on an HVAC contractor (2026-08-19).`
    );
  }
  if (collision && !siblingHeadingCollisions.some((c) => c.slug === collision.slug)) {
    console.log(
      `FONT_UNIQUENESS_CHECK=FAIL — shipped heading font "${extractedHeading}" collides with ${collision.slug}'s heading font "${collision.headingFont}" in the SAME TOWN (${ownTown}). Neighbouring owners can see both sites — swap the import in layout.tsx for a different shortlist entry.`
    );
    hardFail = true;
  }
}

// ── Same-town body-font reuse against the last 8 OTHER records — WARN only ──
const town = ownTown;
if (town && extractedBody) {
  const townCollisions = priors.filter(
    (r) => r.town && r.bodyFont && normFont(r.town) === normFont(town) && normFont(r.bodyFont) === normFont(extractedBody)
  );
  for (const c of townCollisions) {
    console.log(
      `FONT_UNIQUENESS_WARNING — shipped body font "${extractedBody}" was already used in ${town} by ${c.slug}. Not a hard FAIL yet (town-matching data quality unverified) — neighbouring owners see each other's sites, so prefer a different body font if practical.`
    );
  }
}

if (hardFail) {
  process.exit(1);
}

console.log(
  `FONT_UNIQUENESS_CHECK=PASS — heading="${extractedHeading ?? 'unknown'}", body="${extractedBody ?? 'unknown'}"${usedFallbackOrder ? ' (role determined by import order, not variable name)' : ''}`
);

// ── Write the EXTRACTED (verified) values back onto this slug's own record, PASS only ──
// 2026-08-18 (Fable): locked, and re-reads fresh inside the lock rather than trusting the
// module-level `ledger`/`own` (loaded early, at line ~163) — a concurrent script could have
// written in between. Same race class as design-ledger.mjs's record mode.
if (own) {
  await withFileLock(FINGERPRINT_LEDGER, () => {
    let fresh = [];
    if (existsSync(FINGERPRINT_LEDGER)) {
      try {
        const parsed = JSON.parse(readFileSync(FINGERPRINT_LEDGER, 'utf8'));
        if (Array.isArray(parsed)) fresh = parsed;
      } catch { /* unreadable — fall through with fresh=[] , same fail-open posture as above */ }
    }
    const freshOwn = fresh.find((r) => r.slug === slug);
    if (freshOwn) {
      freshOwn.headingFont = extractedHeading ?? freshOwn.headingFont;
      freshOwn.bodyFont = extractedBody ?? freshOwn.bodyFont;
      writeFileSync(FINGERPRINT_LEDGER, JSON.stringify(fresh, null, 2));
    }
  });
  console.log(`FONT_UNIQUENESS_NOTE — verified font values written back onto ${slug}'s record in ${FINGERPRINT_LEDGER}`);
} else {
  console.log(
    `FONT_UNIQUENESS_NOTE — no design-fingerprints.json record for ${slug} (design-ledger.mjs record not run?); extracted fonts not persisted this run`
  );
}
