#!/usr/bin/env node
/**
 * Rescue-rebuild parity check — completeness gate against the old site.
 *
 * Usage:
 *   node scripts/parity-check.js <slug>
 *
 * Reads clients/<slug>/data/parity-checklist.md (written by /gather on rescue
 * leads) and asserts every atom survived into the built site:
 *
 *   TEXT: <literal string>       must appear in the rendered text of some page
 *                                under clients/<slug>/site/out/**\/*.html
 *   ASSET: <path-or-filename>    must exist in the static export (site/out/) —
 *                                public/ alone doesn't count; files copied
 *                                after `npx next build` never reach the deploy
 *   WAIVED: <atom> — <reason>    skipped; echoed so QA surfaces the reason.
 *                                A missing TEXT/ASSET atom whose text appears
 *                                in a WAIVED row counts as waived, not missing
 *   UNCAPTURED: <url> — <title>  informational; echoed (enumerated, not captured)
 *
 * Rows tolerate markdown dressing: "- TEXT: x", "1. TEXT: x", "**TEXT:** x",
 * and backtick-wrapped rows/values all parse as "TEXT: x". Any other non-empty,
 * non-comment line is UNPARSEABLE and fails the check (a checklist row that
 * silently doesn't count would be a hole in the gate itself).
 *
 * The script locates the project root itself (walks up from cwd until it finds
 * clients/<slug>/), so it works from the repo root or from inside the client's
 * site/ directory.
 *
 * Both sides of every TEXT comparison are normalised first: HTML entities
 * decoded, Unicode NFC, NBSP → space, curly quotes → straight, soft hyphens /
 * zero-width characters stripped, whitespace collapsed, unit spacing equated
 * ("31 %" == "31%", "€ 15" == "€15"). Without this, NBSP and entity-encoded
 * output guarantee false alarms on non-English builds (rescue skews EU).
 * BRIGHT LINE: normalisation may only ever equate whitespace/typography
 * variants — never meaning-bearing characters (digits, letters, currency
 * symbol identity).
 *
 * Exit codes: 0 = all atoms placed/waived (or no checklist — nothing to check),
 *             1 = missing atoms or unparseable rows (each listed),
 *             2 = could not run (unknown slug / no built output).
 *
 * Pure node, explicit UTF-8 reads, no shell pipelines — must stay Windows-clean.
 */
"use strict";

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------- normalise

// Named entities worth decoding: XML basics + Latin-1 letters + typography.
// Numeric entities (&#123; / &#xAB;) are decoded generically below.
const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  copy: "©", reg: "®", trade: "™", deg: "°",
  sect: "§", para: "¶", middot: "·", laquo: "«",
  raquo: "»", iexcl: "¡", iquest: "¿", szlig: "ß",
  euro: "€", pound: "£", yen: "¥", cent: "¢",
  ndash: "–", mdash: "—", hellip: "…", bull: "•",
  lsquo: "‘", rsquo: "’", sbquo: "‚",
  ldquo: "“", rdquo: "”", bdquo: "„",
  prime: "′", Prime: "″", times: "×", divide: "÷",
  frac12: "½", frac14: "¼", frac34: "¾", shy: "­",
  agrave: "à", aacute: "á", acirc: "â", atilde: "ã",
  auml: "ä", aring: "å", aelig: "æ", ccedil: "ç",
  egrave: "è", eacute: "é", ecirc: "ê", euml: "ë",
  igrave: "ì", iacute: "í", icirc: "î", iuml: "ï",
  ntilde: "ñ", ograve: "ò", oacute: "ó", ocirc: "ô",
  otilde: "õ", ouml: "ö", oslash: "ø",
  ugrave: "ù", uacute: "ú", ucirc: "û", uuml: "ü",
  yacute: "ý", yuml: "ÿ", eth: "ð", thorn: "þ",
  Agrave: "À", Aacute: "Á", Acirc: "Â", Atilde: "Ã",
  Auml: "Ä", Aring: "Å", AElig: "Æ", Ccedil: "Ç",
  Egrave: "È", Eacute: "É", Ecirc: "Ê", Euml: "Ë",
  Igrave: "Ì", Iacute: "Í", Icirc: "Î", Iuml: "Ï",
  Ntilde: "Ñ", Ograve: "Ò", Oacute: "Ó", Ocirc: "Ô",
  Otilde: "Õ", Ouml: "Ö", Oslash: "Ø",
  Ugrave: "Ù", Uacute: "Ú", Ucirc: "Û", Uuml: "Ü",
  Yacute: "Ý", ETH: "Ð", THORN: "Þ",
};

function codePoint(m, n) {
  // Guard: String.fromCodePoint throws on > 0x10FFFF — leave malformed entities as-is.
  return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
}

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (m, hex) => codePoint(m, parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (m, dec) => codePoint(m, parseInt(dec, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) =>
      Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : m
    );
}

function normalise(s) {
  return decodeEntities(s)
    .normalize("NFC")
    .replace(/[\u00A0\u202F\u2007]/g, " ")   // NBSP variants -> plain space
    .replace(/[\u00AD\u200B-\u200D\uFEFF]/g, "") // soft hyphen + zero-width chars
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")  // curly/typographic -> straight '
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')  // curly/typographic -> straight "
    .replace(/\s+/g, " ")
    // Unit-spacing tolerance: "31 %" == "31%", "€ 15" == "€15", "15 €" == "15€".
    // Locale typography (EU style mandates the space), same equivalence class as
    // NBSP — enforcing it trains operators to WAIVE rows, which erodes the check.
    // BRIGHT LINE: normalisation may only ever equate whitespace/typography variants.
    // Never touch meaning-bearing characters (digits, letters, currency symbol identity).
    .replace(/(\d) ([%‰])/g, "$1$2")
    .replace(/([€£$¥¢]) (\d)/g, "$1$2")
    .replace(/(\d) ([€£$¥¢])/g, "$1$2")
    .trim();
}

// ------------------------------------------------------------- html -> text

function stripBlocks(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

// Two text renderings per page: tags replaced by a space (block-boundary
// safe) and tags removed outright (safe for atoms spanning inline markup,
// e.g. "<strong>€ 15</strong> miljoen"). An atom counts as placed if it
// appears in either rendering of any page.
function htmlToTexts(html) {
  const body = stripBlocks(html);
  return [
    normalise(body.replace(/<[^>]+>/g, " ")),
    normalise(body.replace(/<[^>]+>/g, "")),
  ];
}

function extractRefs(html) {
  const refs = [];
  const re = /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let m;
  while ((m = re.exec(html)) !== null) refs.push(decodeEntities(m[1] || m[2] || m[3] || ""));
  return refs;
}

// ------------------------------------------------------------------- files

function walkFiles(dir) {
  const found = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) found.push(p);
    }
  }
  return found;
}

function toRel(root, p) {
  return path.relative(root, p).split(path.sep).join("/");
}

// Walk up from cwd until a directory containing clients/<slug>/ is found, so
// the check works from the repo root AND from inside clients/<slug>/site/
// (where build's Setup leaves the shell). "Run from the wrong directory"
// must never look identical to "classic build, nothing to check".
function findClientDir(slug) {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "clients", slug);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// -------------------------------------------------------------------- main

function main() {
  const slug = process.argv[2];
  if (!slug || slug.startsWith("-")) {
    console.error("Usage: node scripts/parity-check.js <slug>");
    process.exit(2);
  }

  const clientDir = findClientDir(slug);
  if (!clientDir) {
    console.error(`Could not find clients/${slug}/ under ${process.cwd()} or any parent directory — check the slug and run from inside the project.`);
    process.exit(2);
  }
  const checklistPath = path.join(clientDir, "data", "parity-checklist.md");
  if (!fs.existsSync(checklistPath)) {
    console.log(`No parity checklist at ${checklistPath} — nothing to check (classic build, or gather predates parity).`);
    process.exit(0);
  }
  const outDir = path.join(clientDir, "site", "out");
  const publicDir = path.join(clientDir, "site", "public");
  if (!fs.existsSync(outDir)) {
    console.error(`Built output not found at ${outDir} — run \`npx next build\` in clients/${slug}/site first.`);
    process.exit(2);
  }

  // Parse the checklist. Tolerate markdown dressing (bullets, numbering, bold,
  // backticks); anything else non-empty/non-comment is UNPARSEABLE and fails.
  const textAtoms = [], assetAtoms = [], waived = [], uncaptured = [], unparsed = [];
  const lines = fs.readFileSync(checklistPath, "utf8").split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim()
      .replace(/^(?:[-*+]|\d+[.)])\s+/, "")
      .replace(/^`(.+)`$/, "$1")
      .replace(/^\*\*(TEXT|ASSET|UNCAPTURED|WAIVED):\*\*\s*/, "$1: ")
      .trim();
    if (!line || line.startsWith("#") || line.startsWith("<!--")) return;
    const m = line.match(/^(TEXT|ASSET|UNCAPTURED|WAIVED):\s*(.+)$/);
    if (!m) { unparsed.push(`line ${i + 1}: ${line}`); return; }
    const value = m[2].trim().replace(/^`(.+)`$/, "$1").trim();
    if (m[1] === "TEXT") textAtoms.push(value);
    else if (m[1] === "ASSET") assetAtoms.push(value);
    else if (m[1] === "WAIVED") waived.push(value);
    else uncaptured.push(value);
  });

  // Load the built site.
  const outFilesAbs = walkFiles(outDir);
  const htmlFiles = outFilesAbs.filter((f) => f.toLowerCase().endsWith(".html"));
  if (htmlFiles.length === 0) {
    console.error(`No HTML files under ${outDir} — is the build a static export?`);
    process.exit(2);
  }
  const outFiles = outFilesAbs.map((f) => toRel(outDir, f));
  const pageTexts = [];   // { rel, texts: [spaced, fused] }
  const refs = new Set();
  for (const f of htmlFiles) {
    const html = fs.readFileSync(f, "utf8");
    pageTexts.push({ rel: toRel(outDir, f), texts: htmlToTexts(html) });
    for (const r of extractRefs(html)) refs.add(r);
  }
  const publicFiles = fs.existsSync(publicDir)
    ? walkFiles(publicDir).map((f) => toRel(publicDir, f))
    : [];

  // A missing atom whose text appears inside a WAIVED row counts as waived —
  // build appends the WAIVED row and leaves the original in place, so the
  // audit trail shows both what was asked and what was dropped.
  const waivedNorm = waived.map(normalise);
  function coveredByWaiver(atom) {
    const n = normalise(atom);
    return n.length > 0 && waivedNorm.some((w) => w.includes(n));
  }

  // TEXT atoms.
  const missingText = [], waivedText = [];
  for (const atom of textAtoms) {
    const needle = normalise(atom);
    if (!needle) continue;
    const hit = pageTexts.some((p) => p.texts.some((t) => t.includes(needle)));
    if (!hit) (coveredByWaiver(atom) ? waivedText : missingText).push(atom);
  }

  // ASSET atoms: must be IN THE STATIC EXPORT (site/out/) — that is what
  // deploys. public/ alone doesn't count: files copied there after
  // `npx next build` never reach the live site. Basename-only matching is
  // allowed only for atoms with no directory component.
  function fileMatch(files, clean, base, hasDir) {
    const cleanLower = clean.toLowerCase();
    return files.some((f) => {
      const fl = f.toLowerCase();
      return fl === cleanLower || fl.endsWith("/" + cleanLower) || (!hasDir && fl.split("/").pop() === base);
    });
  }
  const missingAsset = [], waivedAsset = [], missingAssetHints = [];
  for (const atom of assetAtoms) {
    const clean = decodeEntities(atom.trim()).split(/[?#]/)[0].replace(/^\/+/, "");
    const base = clean.toLowerCase().split("/").pop();
    if (!base) continue;
    const hasDir = clean.includes("/");
    if (fileMatch(outFiles, clean, base, hasDir)) continue;
    if (coveredByWaiver(atom)) { waivedAsset.push(atom); continue; }
    missingAsset.push(atom);
    if (fileMatch(publicFiles, clean, base, hasDir)) {
      missingAssetHints.push(`${atom} — present in site/public/ but NOT in site/out/: copy assets BEFORE \`npx next build\`, then rebuild`);
    }
  }

  // Report.
  console.log(`Parity check: ${slug}`);
  console.log(`  Pages scanned: ${htmlFiles.length} HTML file(s) under site/out/`);
  console.log(`  TEXT:  ${textAtoms.length} checked, ${textAtoms.length - missingText.length - waivedText.length} placed, ${waivedText.length} waived, ${missingText.length} missing`);
  console.log(`  ASSET: ${assetAtoms.length} checked, ${assetAtoms.length - missingAsset.length - waivedAsset.length} in the export, ${waivedAsset.length} waived, ${missingAsset.length} missing`);
  if (waived.length) {
    console.log(`  WAIVED (${waived.length}) — deliberately dropped; QA must echo each reason into qa-report.md:`);
    for (const w of waived) console.log(`    - ${w}`);
  }
  if (uncaptured.length) {
    console.log(`  UNCAPTURED (${uncaptured.length}) — enumerated on the old site but not captured (cap), visible by design:`);
    for (const u of uncaptured) console.log(`    - ${u}`);
  }

  const failed = missingText.length || missingAsset.length || unparsed.length;
  if (failed) {
    console.log("\nFAIL:");
    for (const t of missingText) console.log(`  MISSING TEXT: ${t}`);
    for (const a of missingAsset) console.log(`  MISSING ASSET: ${a}`);
    for (const h of missingAssetHints) console.log(`    hint: ${h}`);
    for (const u of unparsed) console.log(`  UNPARSEABLE ROW (fix its prefix or delete it): ${u}`);
    console.log("Place each missing atom on the site, or append a `WAIVED: <atom> — <reason>` row (keep the original row).");
    process.exit(1);
  }
  console.log("\nAll atoms placed or explicitly waived.");
  process.exit(0);
}

main();
