#!/usr/bin/env node
/**
 * aeo-check.mjs — proves a BUILT site is structured so answer engines can extract and attribute it.
 *
 * WHAT THIS CAN AND CANNOT PROVE (read this before quoting it to anyone):
 *
 *   CAN prove, from the artefact:
 *     - the entity graph parses, resolves, and has no dangling @id references
 *     - the business resolves as ONE entity across every route (shared @id, per-page WebPage @id)
 *     - NAP (name / address / phone) is present on every route AND matches the schema
 *     - the FAQ answers in the schema are actually VISIBLE on the page (no invisible markup)
 *     - question-shaped headings exist and are real HTML headings, not images
 *     - every load-bearing fact survives with ALL <script> stripped, i.e. it is in server HTML
 *       and does not depend on JS or on Next's RSC flight payload
 *     - llms.txt is served, parses to the llmstxt.org shape, and its links resolve to real routes
 *     - robots.txt does not block the LIVE-RETRIEVAL crawlers (the ones that decide citation)
 *     - the sitemap covers every built route and nothing that 404s
 *
 *   CANNOT prove, and this script will never claim to:
 *     - that ChatGPT, Perplexity, Claude or Google AI Overviews will cite the site
 *     - that any crawler has fetched the site
 *     - that llms.txt is read by anything (no major answer engine has committed to honouring it)
 *   There is no artefact-level test for a citation. Anyone who tells you otherwise is selling.
 *
 * THE FALSE-GREEN THIS EXISTS TO KILL:
 *   `grep -q "$PHONE" out/index.html` PASSES on a site where the phone number exists only inside
 *   Next's RSC flight payload (`self.__next_f.push([1,"...(972) 849-6443..."])`) — a <script> tag.
 *   A crawler that does not execute JavaScript sees NONE of it. Every text assertion here is made
 *   against HTML with <script>, <style>, <template> and <noscript> REMOVED first.
 *
 * Usage:
 *   node scripts/aeo-check.mjs clients/<slug>/site
 *   node scripts/aeo-check.mjs clients/<slug>/site --json
 *   node scripts/aeo-check.mjs --url https://example.com          (live site, over the network)
 *
 * Exit 0 = PASS. Exit 1 = a real AEO failure. Exit 2 = the check could not run.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Crawler policy. This distinction is load-bearing and is the single most
// misunderstood thing in AEO: a TRAINING crawler decides whether your text may
// be used to train a model. A LIVE-RETRIEVAL crawler decides whether your page
// can be fetched and cited in an answer RIGHT NOW. Blocking a training crawler
// costs you nothing today; blocking a retrieval crawler removes you from that
// engine's answers entirely.
// ---------------------------------------------------------------------------
const RETRIEVAL_CRAWLERS = [
  'Googlebot',        // Google - AI Overviews and AI Mode are served off the ORDINARY Google index
                      // via Googlebot. Google's own AI-features doc: robots.txt for Googlebot is the
                      // control. Blocking Google-Extended does NOT remove you from AI Overviews.
  'Bingbot',          // Microsoft - the Bing index is what Copilot, and ChatGPT search, ground on.
  'OAI-SearchBot',    // OpenAI - "Sites that are opted out of OAI-SearchBot will not be shown in
                      // ChatGPT search answers." (developers.openai.com/api/docs/bots)
  'ChatGPT-User',     // OpenAI - user-triggered fetch when someone asks ChatGPT about your page.
  'PerplexityBot',    // Perplexity - "designed to surface and link websites in search results on
                      // Perplexity. It is not used to crawl content for AI foundation models."
  'Perplexity-User',  // Perplexity - user-triggered fetch.
  'Claude-User',      // Anthropic - blocking "prevents our system from retrieving your content in
                      // response to a user query."
  'Claude-SearchBot', // Anthropic - blocking "prevents our system from indexing your content".
  'Applebot',         // Apple - Siri, Spotlight, Safari. Renders JS (one of only two that do).
];

const TRAINING_CRAWLERS = [
  'GPTBot',             // OpenAI training
  'ClaudeBot',          // Anthropic training
  'Google-Extended',    // Gemini training. Blocking it does NOT remove you from AI Overviews,
                        // which are served off the ordinary Google index via Googlebot.
  'Applebot-Extended',  // Apple training
  'meta-externalagent', // Meta training
  'CCBot',              // Common Crawl - feeds many downstream training sets
];

const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const urlIdx = args.indexOf('--url');
const liveUrl = urlIdx !== -1 ? args[urlIdx + 1] : null;
const siteDir = args.find((a) => !a.startsWith('--') && a !== liveUrl) || null;

const failures = [];
const warnings = [];
const notes = [];
const facts = {};
const fail = (m) => failures.push(m);
const warn = (m) => warnings.push(m);
const note = (m) => notes.push(m);

// ---------------------------------------------------------------------------
// HTML -> text, with every script/style/template/noscript block REMOVED FIRST.
// This is the whole point of the file. Do not "optimise" it into a plain regex
// over raw HTML.
// ---------------------------------------------------------------------------
function visibleText(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<template\b[\s\S]*?<\/template>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&(?:lt|gt|apos|#39);/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Headings, in document order, with their level. Text only - a heading whose
// content is an <img> yields '' and is reported, because an answer engine
// cannot lift a heading that is a picture of words.
function headings(html) {
  const stripped = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
  const out = [];
  for (const m of stripped.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const inner = m[2];
    out.push({
      level: Number(m[1]),
      text: visibleText(inner),
      imageOnly: /<img\b/i.test(inner) && visibleText(inner) === '',
    });
  }
  return out;
}

const INTERROGATIVE = /^(who|what|when|where|why|how|do|does|did|is|are|can|could|will|would|should|am|was|were|have|has|must|may)\b/i;
const isQuestionShaped = (t) => t.trim().endsWith('?') || INTERROGATIVE.test(t.trim());

function jsonLdBlocks(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    out.push(m[1]);
  }
  return out;
}

// Flatten @graph / arrays / nested nodes into a flat node list.
function flattenNodes(root, acc = []) {
  if (Array.isArray(root)) { root.forEach((r) => flattenNodes(r, acc)); return acc; }
  if (!root || typeof root !== 'object') return acc;
  if (root['@graph']) flattenNodes(root['@graph'], acc);
  if (root['@type']) acc.push(root);
  for (const [k, v] of Object.entries(root)) {
    // '@graph' is walked above; walking it again here double-counts every node,
    // which turns one WebPage into two and manufactures a duplicate-@id failure.
    if (k !== '@graph' && v && typeof v === 'object') flattenNodes(v, acc);
  }
  return acc;
}
// Every bare {"@id": ...} reference anywhere in the tree.
function idReferences(root, acc = []) {
  if (Array.isArray(root)) { root.forEach((r) => idReferences(r, acc)); return acc; }
  if (!root || typeof root !== 'object') return acc;
  const keys = Object.keys(root);
  if (keys.length === 1 && keys[0] === '@id') acc.push(root['@id']);
  for (const v of Object.values(root)) if (v && typeof v === 'object') idReferences(v, acc);
  return acc;
}
const typesOf = (n) => (Array.isArray(n['@type']) ? n['@type'] : [n['@type']]).filter(Boolean);

// schema.org business-ish types. The enforced rule is "not bare LocalBusiness when a
// subtype fits", so anything business-shaped matches and bare LocalBusiness only warns.
const BUSINESSY = /(Business|Contractor|Store|Shop|Service|Restaurant|Salon|Clinic|Agency|Company|Repair|Dentist|Plumber|Electrician|Locksmith|Florist|Bakery|Cafe|Hotel|Gym|School|Organization|Roofing|Painter|Landscap|Moving|Pest|Cleaning|Legal|Attorney|Medical|Veterinar|Pharmacy|Lodging|Automotive|Motorcycle|Garden|Home|Professional|Emergency|Financial|Insurance|RealEstate|Travel|Sports|Entertainment)/i;

// ---------------------------------------------------------------------------
// Load the site: either an exported out/ dir or a live URL.
// ---------------------------------------------------------------------------
async function loadFromDir(dir) {
  const outDir = ['out', '.next/server/app', 'dist', 'build']
    .map((d) => join(dir, d))
    .find((d) => existsSync(d));
  if (!outDir) {
    console.error(`aeo-check: no built output under ${dir}. Run \`npx next build\` first.`);
    process.exit(2);
  }
  const htmlFiles = [];
  (function walk(d) {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) { if (e !== '_next' && !e.startsWith('.')) walk(p); }
      else if (e.endsWith('.html')) htmlFiles.push(p);
    }
  })(outDir);

  const routes = {};
  for (const f of htmlFiles) {
    let rel = relative(outDir, f).replace(/\.html$/, '');
    rel = rel === 'index' ? '/' : '/' + rel.replace(/\/index$/, '');
    if (rel.startsWith('/_') || rel === '/404' || rel === '/500') continue;
    routes[rel] = readFileSync(f, 'utf8');
  }
  return {
    routes,
    readAsset: (name) => (existsSync(join(outDir, name)) ? readFileSync(join(outDir, name), 'utf8') : null),
    source: outDir,
    live: false,
  };
}

async function loadFromUrl(base) {
  const origin = base.replace(/\/+$/, '');
  const get = async (p) => {
    const r = await fetch(origin + p, { redirect: 'follow' });
    return r.ok ? await r.text() : null;
  };
  const home = await get('/');
  if (home === null) { console.error(`aeo-check: ${origin}/ did not serve 200`); process.exit(2); }
  const routes = { '/': home };
  const sm = await get('/sitemap.xml');
  if (sm) {
    // Sitemap routes are independent fetches with no ordering dependency (Fable consult,
    // 2026-08-19) — fetch the whole set concurrently instead of one page at a time.
    const paths = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)]
      .map((m) => new URL(m[1]).pathname.replace(/\/$/, '') || '/')
      .filter((p) => !routes[p]);
    const pages = await Promise.all(paths.map((p) => get(p)));
    paths.forEach((p, i) => { if (pages[i]) routes[p] = pages[i]; });
  }
  const cache = {};
  for (const n of ['llms.txt', 'robots.txt', 'sitemap.xml']) cache[n] = await get('/' + n);
  return { routes, readAsset: (n) => cache[n] ?? null, source: origin, live: true };
}

// ---------------------------------------------------------------------------
const site = liveUrl ? await loadFromUrl(liveUrl) : await loadFromDir(resolve(siteDir || '.'));
const routeNames = Object.keys(site.routes).sort();
facts.routes = routeNames;
if (routeNames.length === 0) { console.error('aeo-check: no routes found'); process.exit(2); }

// === 1. ENTITY GRAPH ========================================================
const allNodes = [];
const idOwners = new Map();
const perRoute = {};

for (const r of routeNames) {
  const html = site.routes[r];
  const blocks = jsonLdBlocks(html);
  perRoute[r] = { blocks: blocks.length, nodes: [], refs: [], text: visibleText(html), headings: headings(html) };
  if (blocks.length === 0) {
    fail(`[schema] ${r} carries NO JSON-LD at all - the page has no machine-readable identity`);
    continue;
  }
  for (const [i, raw] of blocks.entries()) {
    let parsed;
    try { parsed = JSON.parse(raw.replace(/\\u003c/g, '<')); }
    catch (e) { fail(`[schema] ${r} JSON-LD block ${i + 1} DOES NOT PARSE: ${e.message}`); continue; }
    if (parsed['@context'] && !JSON.stringify(parsed['@context']).includes('schema.org')) {
      fail(`[schema] ${r} block ${i + 1} @context is not schema.org`);
    }
    const nodes = flattenNodes(parsed);
    perRoute[r].nodes.push(...nodes);
    allNodes.push(...nodes.map((n) => ({ route: r, node: n })));
    for (const n of nodes) {
      if (n['@id'] && Object.keys(n).length > 1) {
        if (!idOwners.has(n['@id'])) idOwners.set(n['@id'], new Set());
        idOwners.get(n['@id']).add(r);
      }
    }
    perRoute[r].refs.push(...idReferences(parsed));
  }
}

// Empty-string properties are worse than absent ones: they assert a fact of "".
for (const { route, node } of allNodes) {
  for (const [k, v] of Object.entries(node)) {
    if (v === '' || (Array.isArray(v) && v.length === 0)) {
      fail(`[schema] ${route} node ${typesOf(node).join('/')} has EMPTY property "${k}" - omit the property instead of asserting ""`);
    }
  }
}

// The business node - the thing the whole exercise exists to make unambiguous.
const businessNodes = allNodes.filter(({ node }) => typesOf(node).some((t) => BUSINESSY.test(t)) && node.name && node.address !== undefined);
const businessIds = new Set(businessNodes.map(({ node }) => node['@id']).filter(Boolean));
facts.businessIds = [...businessIds];

if (businessNodes.length === 0) {
  fail('[entity] no LocalBusiness/Organization node with an address found - the site does not say what business it is or where');
} else {
  if (businessIds.size > 1) {
    fail(`[entity] the business is claimed under ${businessIds.size} DIFFERENT @ids (${[...businessIds].join(', ')}) - answer engines will resolve this as more than one business`);
  }
  if (businessIds.size === 0) {
    fail('[entity] the business node has no @id - nothing else in the graph can reference it, so it is an island, not a graph');
  }
  const b = businessNodes[0].node;
  facts.businessType = typesOf(b).join(',');
  facts.businessName = b.name;
  if (typesOf(b).length === 1 && typesOf(b)[0] === 'LocalBusiness') {
    warn("[entity] business typed as bare LocalBusiness - use the most specific schema.org subtype that fits (Google's explicit guidance)");
  }
  for (const req of ['name', 'url', 'telephone']) {
    if (!b[req]) fail(`[entity] business node missing "${req}"`);
  }
  if (!b.address) fail('[entity] business node has no address - NAP is the primary local-entity key');
  if (!b.areaServed) fail('[entity] business node has no areaServed - this is what answers "who does X in <town>"');
  const sameAs = [].concat(b.sameAs || []);
  facts.sameAs = sameAs;
  if (sameAs.length === 0) {
    fail("[entity] business node has no sameAs - nothing links this site to the business's Google/Facebook/Instagram profiles, so the entity cannot be reconciled with profiles engines already trust");
  } else {
    for (const s of sameAs) {
      if (!/^https?:\/\//.test(s)) fail(`[entity] sameAs entry is not an absolute URL: ${JSON.stringify(s)}`);
    }
    if (sameAs.length < 2) warn(`[entity] only ${sameAs.length} sameAs link - more independent profiles means a stronger entity match`);
  }
  facts.areaServed = [].concat(b.areaServed || []).map((a) => (typeof a === 'string' ? a : a.name)).filter(Boolean);
}

// Per-page WebPage identity: four routes claiming one @id is a self-inflicted duplicate.
const webPageIds = new Map();
for (const { route, node } of allNodes) {
  if (!typesOf(node).includes('WebPage')) continue;
  const id = node['@id'];
  if (!id) { fail(`[entity] ${route} WebPage node has no @id`); continue; }
  if (!webPageIds.has(id)) webPageIds.set(id, []);
  webPageIds.get(id).push(route);
}
for (const [id, rs] of webPageIds) {
  const uniq = [...new Set(rs)];
  if (uniq.length > 1) fail(`[entity] WebPage @id "${id}" is claimed by ${uniq.length} routes (${uniq.join(', ')}) - each page needs its own path-carrying @id`);
}
for (const r of routeNames) {
  if (perRoute[r].blocks && !perRoute[r].nodes.some((n) => typesOf(n).includes('WebPage'))) {
    warn(`[entity] ${r} has no WebPage node`);
  }
}

// Dangling @id references, resolved against the SITE-WIDE union of defined ids.
const definedIds = new Set(idOwners.keys());
for (const r of routeNames) {
  for (const ref of new Set(perRoute[r].refs)) {
    if (!definedIds.has(ref)) {
      fail(`[entity] ${r} references @id "${ref}" which NO node anywhere on the site defines - a broken edge in the graph`);
    }
  }
}

// === 2. FAQ / ANSWER-SHAPED CONTENT =========================================
// The rule that matters: a Question in the markup whose Answer is NOT visible on
// the page is invisible markup. It breaches Google's structured-data policy AND
// gives an answer engine text it cannot corroborate against the rendered page.
let totalQuestions = 0;
for (const r of routeNames) {
  const faqNodes = perRoute[r].nodes.filter((n) => typesOf(n).includes('FAQPage'));
  if (faqNodes.length === 0) continue;
  const pageText = perRoute[r].text.toLowerCase();
  const pageHeadings = perRoute[r].headings.map((h) => h.text.toLowerCase().replace(/\s+/g, ' '));
  for (const faq of faqNodes) {
    const qs = [].concat(faq.mainEntity || []);
    if (qs.length === 0) { fail(`[faq] ${r} FAQPage has no mainEntity questions`); continue; }
    for (const q of qs) {
      totalQuestions++;
      const qname = (q.name || '').trim();
      const atext = ((q.acceptedAnswer || {}).text || '').trim();
      if (!qname) { fail(`[faq] ${r} a Question has no name`); continue; }
      if (!atext) { fail(`[faq] ${r} question "${qname}" has no acceptedAnswer text`); continue; }
      if (!isQuestionShaped(qname)) {
        warn(`[faq] ${r} "${qname}" is not phrased as a question - answer engines match on the question form people actually type`);
      }
      const qNorm = qname.toLowerCase().replace(/\s+/g, ' ');
      if (!pageHeadings.some((h) => h === qNorm)) {
        fail(`[faq] ${r} question "${qname}" is in the markup but is NOT a rendered heading on the page - invisible markup`);
      }
      const probe = visibleText(atext).toLowerCase().slice(0, 60);
      if (probe && !pageText.includes(probe)) {
        fail(`[faq] ${r} the ANSWER to "${qname}" is in the markup but not in the rendered page text - invisible markup`);
      }
    }
  }
}
facts.faqQuestions = totalQuestions;
if (totalQuestions === 0) {
  fail('[faq] no FAQPage/Question markup anywhere - there are no answer-shaped blocks for an engine to lift');
} else if (totalQuestions < 4) {
  warn(`[faq] only ${totalQuestions} question(s) - 4-6 covering the questions customers actually ask is the target`);
}

// === 3. HEADINGS / EXTRACTABILITY ==========================================
let questionHeadings = 0;
for (const r of routeNames) {
  const hs = perRoute[r].headings;
  const h1s = hs.filter((h) => h.level === 1);
  if (h1s.length === 0) fail(`[extract] ${r} has no <h1>`);
  if (h1s.length > 1) fail(`[extract] ${r} has ${h1s.length} <h1> elements - exactly one, naming who/what/where`);
  if (hs.filter((h) => h.level === 2).length === 0) warn(`[extract] ${r} has no <h2> - engines chunk on headings; a wall of text has no seams`);
  for (const h of hs) {
    if (h.imageOnly) fail(`[extract] ${r} has a heading whose only content is an image - a crawler cannot read a picture of words`);
    if (isQuestionShaped(h.text)) questionHeadings++;
  }
  const words = perRoute[r].text.split(/\s+/).filter(Boolean).length;
  perRoute[r].words = words;
  if (words < 120) fail(`[extract] ${r} renders only ${words} words with <script> stripped - content is thin or trapped in JS`);
}
facts.questionHeadings = questionHeadings;
facts.wordsPerRoute = Object.fromEntries(routeNames.map((r) => [r, perRoute[r].words]));
if (questionHeadings === 0) fail('[extract] not one question-shaped heading on the whole site');

// === 4. NAP CONSISTENCY ACROSS EVERY ROUTE ==================================
const bizNode = businessNodes[0] && businessNodes[0].node;
if (bizNode) {
  const name = bizNode.name;
  const tel = bizNode.telephone || '';
  const addr = bizNode.address || {};
  const street = addr.streetAddress || '';
  const locality = addr.addressLocality || '';
  facts.nap = { name, telephone: tel, streetAddress: street, addressLocality: locality };

  // Digits-only phone comparison: schema carries E.164, the page carries the national
  // display form. Comparing raw strings would be a guaranteed false failure.
  const telDigits = tel.replace(/\D/g, '');
  const missingName = routeNames.filter((r) => !perRoute[r].text.toLowerCase().includes(String(name).toLowerCase()));
  if (missingName.length) fail(`[nap] business NAME absent from rendered text on: ${missingName.join(', ')}`);

  const missingPhone = routeNames.filter((r) => {
    const d = perRoute[r].text.replace(/\D/g, '');
    return telDigits.length >= 7 && !d.includes(telDigits.slice(-10));
  });
  if (missingPhone.length) fail(`[nap] PHONE absent from rendered text on: ${missingPhone.join(', ')} (schema says ${tel})`);

  if (street) {
    if (!routeNames.some((r) => perRoute[r].text.includes(street))) {
      fail(`[nap] the schema streetAddress "${street}" appears on NO page - schema NAP must be corroborated by rendered text`);
    }
    // The corrupt-address class of bug (GR-185 ships "560626 The" live today).
    if (/^\d+\s+(the|a|an|of|and)$/i.test(street.trim()) || street.trim().length < 4) {
      fail(`[nap] streetAddress "${street}" looks like a truncation artefact, not an address`);
    }
  }
  if (locality && routeNames.every((r) => !perRoute[r].text.toLowerCase().includes(locality.toLowerCase()))) {
    fail(`[nap] addressLocality "${locality}" appears on no page`);
  }
}

// === 5. llms.txt ============================================================
const llms = site.readAsset('llms.txt');
if (!llms) {
  fail('[llms] no llms.txt - the one file that states, in plain text, what this business is and where the real pages are');
} else {
  facts.llmsBytes = llms.length;
  const lines = llms.split('\n');
  if (!/^#\s+\S/.test(lines[0] || '')) fail('[llms] llms.txt must open with a single `# <Business Name>` H1 (llmstxt.org)');
  if (!lines.some((l) => /^>\s+\S/.test(l))) fail('[llms] llms.txt has no `> ` blockquote summary line');
  const sections = [...llms.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
  facts.llmsSections = sections;
  if (sections.length < 2) fail(`[llms] llms.txt has ${sections.length} H2 section(s) - needs at least a facts section and a key-pages section`);
  const links = [...llms.matchAll(/\]\((https?:\/\/[^)]+)\)/g)].map((m) => m[1]);
  facts.llmsLinks = links;
  if (links.length === 0) fail('[llms] llms.txt lists no markdown links - the format exists to point at the real pages');
  if (!site.live) {
    for (const l of links) {
      const p = new URL(l).pathname.replace(/\/$/, '') || '/';
      if (!routeNames.includes(p)) fail(`[llms] llms.txt links ${l} but there is no such route in the build (routes: ${routeNames.join(' ')})`);
    }
    for (const r of routeNames) {
      if (!links.some((l) => (new URL(l).pathname.replace(/\/$/, '') || '/') === r)) {
        warn(`[llms] route ${r} is not listed in llms.txt`);
      }
    }
  }
  // Placeholder detection - the GR-185 failure mode, shipped live today.
  for (const bad of ['Our Services', 'Lorem ipsum', 'TODO', 'PLACEHOLDER', 'undefined', '[object Object]']) {
    if (llms.includes(bad)) fail(`[llms] llms.txt contains the placeholder "${bad}" - it shipped without real content`);
  }
}

// === 6. robots.txt - crawler eligibility ====================================
const robots = site.readAsset('robots.txt');
if (!robots) {
  fail('[robots] no robots.txt');
} else {
  if (!/^sitemap:/im.test(robots)) fail('[robots] robots.txt has no Sitemap: line - this is the zero-credential submission path');
  const groups = [];
  let cur = null;
  for (const raw of robots.split('\n')) {
    const line = raw.trim();
    const ua = line.match(/^user-agent:\s*(.+)$/i);
    if (ua) {
      if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(ua[1].trim());
      continue;
    }
    const rule = line.match(/^(allow|disallow):\s*(.*)$/i);
    if (rule && cur) cur.rules.push({ type: rule[1].toLowerCase(), path: rule[2].trim() });
  }
  const named = (agent) => groups.find((g) => g.agents.some((a) => a.toLowerCase() === agent.toLowerCase()));
  const wildcard = groups.find((g) => g.agents.includes('*'));
  const blocked = [];
  const unnamed = [];
  for (const c of RETRIEVAL_CRAWLERS) {
    const g = named(c) || wildcard;
    if (!g) { blocked.push(c); continue; }
    if (g.rules.some((r) => r.type === 'disallow' && r.path === '/')) blocked.push(c);
    if (!named(c)) unnamed.push(c);
  }
  facts.retrievalCrawlersBlocked = blocked;
  if (blocked.length) {
    fail(`[robots] LIVE-RETRIEVAL crawlers blocked or uncovered: ${blocked.join(', ')} - blocking these removes the site from those engines' answers entirely`);
  }
  if (unnamed.length) {
    warn(`[robots] retrieval crawlers covered only by the wildcard, not named: ${unnamed.join(', ')} - naming them makes the intent explicit and survives a later wildcard Disallow`);
  }
  facts.trainingCrawlersNamed = TRAINING_CRAWLERS.filter((c) => named(c));
  note(`training crawlers explicitly named: ${facts.trainingCrawlersNamed.length ? facts.trainingCrawlersNamed.join(', ') : 'none (wildcard only)'}`);
}

// === 7. sitemap =============================================================
const sitemap = site.readAsset('sitemap.xml');
if (!sitemap) {
  fail('[sitemap] no sitemap.xml');
} else {
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  facts.sitemapUrls = locs;
  if (!site.live) {
    const paths = locs.map((l) => new URL(l).pathname.replace(/\/$/, '') || '/');
    for (const r of routeNames) if (!paths.includes(r)) fail(`[sitemap] built route ${r} is missing from sitemap.xml`);
    for (const p of paths) if (!routeNames.includes(p)) fail(`[sitemap] sitemap lists ${p} but no such route was built - it will 404`);
  }
}

// === 8. noindex =============================================================
//
// A spec build ships `noindex` DELIBERATELY (Jeff, 2026-08-15: indexing stays off on subdomain
// builds until the client pays), and `/seo` removes it at conversion. Failing on it unconditionally
// made AEO_CHECK=FAIL on every unconverted build — verified on impact-landscapes-frisco, 4 routes,
// 4 failures — while build/SKILL.md claimed the opposite ("treats a deliberate spec-build noindex
// as expected rather than a defect, so the gate does not go permanently red"). Running code won,
// and the running code was wrong about the design.
//
// A gate that is red on every single run is worse than no gate: it trains everyone to ignore the
// one signal that is supposed to mean something. So the check now distinguishes the two cases it
// was always meant to:
//
//   spec build  (data/seo.md absent) -> noindex is EXPECTED         -> note
//   converted   (data/seo.md present) -> /seo should have removed it -> fail, loudly
//
// The conversion signal is `data/seo.md`, written by /seo, sitting next to the site dir. For a
// --live check the file is not reachable, and a live site under a real domain has by definition
// been through conversion — so noindex there stays a hard failure.
const seoRan = site.live
  ? true
  : existsSync(resolve(siteDir || '.', '..', 'data', 'seo.md'));

for (const r of routeNames) {
  if (!/<meta[^>]+name=["']robots["'][^>]*noindex/i.test(site.routes[r].slice(0, 30000))) continue;
  if (seoRan) {
    fail(`[robots] ${r} carries a noindex meta tag - every other signal on this page is wasted`);
  } else {
    note(`[robots] ${r} is noindex - expected on a spec build; /seo removes it at conversion`);
  }
}

// ---------------------------------------------------------------------------
const pass = failures.length === 0;
if (jsonOut) {
  console.log(JSON.stringify({ result: pass ? 'PASS' : 'FAIL', source: site.source, failures, warnings, notes, facts }, null, 2));
} else {
  console.log(`\naeo-check - ${site.source}`);
  console.log(`routes: ${routeNames.join(' ')}`);
  console.log(`entity: ${facts.businessType || '(none)'} "${facts.businessName || ''}" @id ${(facts.businessIds || []).join(' ') || '(none)'}`);
  console.log(`sameAs: ${(facts.sameAs || []).length}  areaServed: ${(facts.areaServed || []).length}  FAQ questions: ${facts.faqQuestions}  question-shaped headings: ${facts.questionHeadings}`);
  console.log(`rendered words per route (scripts stripped): ${JSON.stringify(facts.wordsPerRoute)}`);
  if (notes.length) { console.log('\nNOTES'); notes.forEach((n) => console.log('  - ' + n)); }
  if (warnings.length) { console.log('\nWARN'); warnings.forEach((w) => console.log('  ! ' + w)); }
  if (failures.length) { console.log('\nFAIL'); failures.forEach((f) => console.log('  x ' + f)); }
  console.log(`\nAEO_CHECK=${pass ? 'PASS' : 'FAIL'}  (${failures.length} failure(s), ${warnings.length} warning(s))`);
  console.log('This proves structure and extractability. It CANNOT prove any answer engine cites the site.\n');
}
process.exit(pass ? 0 : 1);
