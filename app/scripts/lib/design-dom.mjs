/**
 * design-dom.mjs — shared measurement primitives for the design gates.
 *
 * WHY A SHARED MODULE. `richness-check.mjs` and `verify-design-intent.mjs` were both growing their
 * own regex-over-raw-HTML measurements, and regex-over-raw-HTML structurally CANNOT answer the two
 * questions the rejected build actually failed on:
 *
 *   "are these elements SIBLINGS?"     — a regex counts a class string anywhere on the page, so it
 *                                        cannot tell 12 rows in ONE list from 12 rows scattered
 *                                        across 6 sections (only the first is a monotony defect),
 *                                        and it cannot exclude the nav, whose repeated links
 *                                        false-positived the first calibration of richness-check
 *                                        § 15 by 36 hits.
 *   "what is this element sitting ON?" — the perceptual weight of a colour is meaningless without
 *                                        the ground it is painted against, and that ground is an
 *                                        ANCESTOR, which a flat regex cannot reach. Measured: the
 *                                        rejected build's secondary was 32x `bg-secondary/5` and
 *                                        `border-secondary/20` — 51 "usages" by the old counter,
 *                                        near-zero paint.
 *
 * One small tag-stack parser producing parent/ancestor links, plus the colour maths both files
 * need. No dependencies — the built output is static-export HTML, well-formed by construction from
 * JSX, which is exactly the case a tag-stack parser handles correctly.
 *
 * NOT a browser. Everything here derives from shipped markup and compiled CSS, so it measures
 * DECLARED structure, never RENDERED layout. Where a rule genuinely needs rendered geometry (e.g.
 * "1.5x rendered area"), that is stated as a limit rather than faked with a proxy.
 */

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);
const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

/**
 * Parse HTML into a flat node list with parent/ancestor links.
 * Each node: { tag, cls, attrs, textLen, imgs, id, parent, ancestors, start, end }
 *  - textLen accumulates into EVERY open ancestor, so a card's textLen includes its heading and
 *    body — which is what "is this a real content block or a decorative chip?" actually needs.
 *  - a stray/mismatched close tag unwinds to the nearest matching open tag rather than throwing.
 *    A checker that crashes is a checker that never runs, which is worse than one that misses.
 */
export function parseDom(html) {
  const nodes = [];
  const stack = [];
  const re = new RegExp(TAG_RE.source, 'g');
  let lastIdx = 0;
  for (const m of html.matchAll(re)) {
    const [, close, tagRaw, attrs] = m;
    const tag = tagRaw.toLowerCase();
    const textLen = html.slice(lastIdx, m.index).replace(/\s+/g, ' ').trim().length;
    if (textLen) for (const s of stack) s.textLen += textLen;
    lastIdx = m.index + m[0].length;
    if (close) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) { stack[i].end = m.index; stack.length = i; break; }
      }
      continue;
    }
    const selfClosing = /\/$/.test(attrs) || VOID_TAGS.has(tag);
    const cls = (attrs.match(/\bclass="([^"]*)"/) || [])[1] || '';
    const node = {
      tag, cls, attrs, textLen: 0, imgs: 0,
      id: nodes.length,
      start: m.index,
      end: lastIdx,
      parent: stack.length ? stack[stack.length - 1].id : -1,
      ancestors: stack.map((s) => s.id),
      children: [],
    };
    if (stack.length) stack[stack.length - 1].children.push(node.id);
    nodes.push(node);
    if (tag === 'img') for (const a of node.ancestors) nodes[a].imgs++;
    if (!selfClosing) stack.push(node);
  }
  return nodes;
}

/** Site chrome — nav, header, footer, mobile drawer. Repetition there is CORRECT (a nav IS a list
 * of equal links) and it false-positived the first calibration of the identical-sibling gate. */
export function chromeNodeIds(nodes) {
  const ids = new Set();
  for (const n of nodes) {
    if (n.tag === 'nav' || n.tag === 'header' || n.tag === 'footer') ids.add(n.id);
    else if (/\b(menu|drawer|breadcrumb|site-?nav|skip-link)\b/.test(n.cls)) ids.add(n.id);
  }
  return ids;
}
export const inChrome = (n, chromeIds) => chromeIds.has(n.id) || n.ancestors.some((a) => chromeIds.has(a));

/* ── VISUAL SIGNATURE ──────────────────────────────────────────────────────────────────────────
 * The point of this file. Two siblings are "visually uniform" when a reader scanning at arm's
 * length cannot tell them apart — which is NOT the same as byte-identical class strings, the thing
 * every previous repetition check keyed on. `p-6 hover:bg-x/5 transition-colors` and
 * `p-6 hover:bg-x/10 transition-all` are different strings and the same block to a reader.
 *
 * So: drop everything invisible in a still frame (interaction states, transitions, animation,
 * z-order, overflow, positioning), collapse responsive prefixes onto the base utility, keep only
 * the utilities that decide SHAPE, WEIGHT and GROUND, and sort. What survives fingerprints how the
 * block LOOKS, not how it was written.
 */
const STRIP_PREFIX = /^(?:sm|md|lg|xl|2xl|hover|focus|focus-visible|active|group-hover|group-focus|peer-focus|first|last|odd|even|motion-safe|motion-reduce|dark|print|open|disabled):/;
const INVISIBLE_IN_A_STILL = /transition|duration-|ease-|delay-|animate-|will-change|truncate|shrink|grow|overflow-|^relative$|^absolute$|^fixed$|^sticky$|z-\d|order-|opacity-|backdrop-|scroll-|antialiased|cursor-|select-|pointer-events|sr-only|isolate|contain-|^group$|^peer$/;
const SHAPE_DEFINING = /^(flex$|flex-col|flex-row|flex-wrap|grid$|grid-cols-|block$|inline-flex|inline-block|items-|justify-|gap-|gap-x-|gap-y-|p-\d|px-\d|py-\d|pt-\d|pb-\d|border|rounded|shadow|bg-|text-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$|font-(?:bold|semibold|medium|light|normal|display|body)$|aspect-|col-span-|row-span-|w-|h-\d|h-full|min-h-|max-w-|divide-)/;

export function visualSignature(cls) {
  const toks = new Set();
  for (const raw of String(cls).split(/\s+/)) {
    if (!raw || INVISIBLE_IN_A_STILL.test(raw)) continue;
    const t = raw.replace(STRIP_PREFIX, '');
    if (SHAPE_DEFINING.test(t)) toks.add(t);
  }
  return [...toks].sort().join(' ');
}

/**
 * Groups of visually-uniform SIBLINGS (same parent, same tag, same visual signature).
 * Excludes site chrome, form controls, table rows, bare icons, and anything with no real content —
 * all legitimately repetitive, and all false positives in earlier calibrations of the older gates.
 */
const NEVER_A_RHYTHM_UNIT = new Set(['input', 'textarea', 'select', 'option', 'label', 'svg',
  'path', 'circle', 'rect', 'g', 'br', 'script', 'style', 'head', 'meta', 'link', 'html', 'body',
  'tr', 'td', 'th', 'thead', 'tbody', 'source', 'picture']);

export function uniformSiblingGroups(html, { minContentChars = 15 } = {}) {
  const nodes = parseDom(html);
  const chromeIds = chromeNodeIds(nodes);
  const groups = new Map();
  for (const n of nodes) {
    if (inChrome(n, chromeIds)) continue;
    if (NEVER_A_RHYTHM_UNIT.has(n.tag)) continue;
    if (n.textLen < minContentChars && n.imgs === 0) continue;
    const sig = visualSignature(n.cls);
    // A signature of one or two utilities is not a described block — it is an unstyled wrapper.
    if (!sig || sig.split(' ').length < 3) continue;
    const key = `${n.parent}|${n.tag}|${sig}`;
    if (!groups.has(key)) groups.set(key, { parent: n.parent, tag: n.tag, sig, members: [] });
    groups.get(key).members.push(n);
  }
  return { nodes, groups: [...groups.values()].sort((a, b) => b.members.length - a.members.length) };
}

/* ── COLOUR ────────────────────────────────────────────────────────────────────────────────────
 * WCAG relative luminance answers "can a reader tell these two grounds apart"; OKLab chroma
 * answers "is this actually a colour, or a grey pretending to be one".
 */
export function parseColor(str) {
  if (!str) return null;
  const s = String(str).trim();
  let m = s.match(/^#([0-9a-fA-F]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255), a };
  }
  // rgb(1 2 3 / .5) | rgb(1,2,3) | rgba(1,2,3,.5) | Tailwind's `rgb(r g b/var(--tw-bg-opacity,1)`
  m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[/,]\s*([\d.]+%?|var\([^)]*\)))?/);
  if (m) {
    let a = 1;
    const raw = m[4];
    if (raw && !/^var/.test(raw)) a = raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw);
    return { rgb: [m[1], m[2], m[3]].map((v) => parseFloat(v) / 255), a };
  }
  return null;
}
const toLinear = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export function luminance(color) {
  const c = typeof color === 'string' ? parseColor(color) : color;
  if (!c) return null;
  const [r, g, b] = c.rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function oklab(color) {
  const c = typeof color === 'string' ? parseColor(color) : color;
  if (!c) return null;
  const [r, g, b] = c.rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  };
}
export function chroma(color) {
  const o = oklab(color);
  return o ? Math.hypot(o.a, o.b) : null;
}
/** Perceptual distance in OKLab, alpha-aware: a stop that only changes alpha still separates. */
export function perceptualDelta(c1, c2) {
  const a = typeof c1 === 'string' ? parseColor(c1) : c1;
  const b = typeof c2 === 'string' ? parseColor(c2) : c2;
  if (!a || !b) return null;
  const oa = oklab(a), ob = oklab(b);
  const colourDelta = Math.hypot(oa.L - ob.L, oa.a - ob.a, oa.b - ob.b);
  const alphaDelta = Math.abs((a.a ?? 1) - (b.a ?? 1));
  // Alpha and colour both move the painted result; take the larger. A transparent-to-solid scrim is
  // a real ramp even though both its stops name the same hex.
  return Math.max(colourDelta, alphaDelta);
}

/**
 * class -> painted colour, read out of the COMPILED CSS rather than guessed from a token name.
 * Tailwind inlines resolved values at build time, so this is empirical: whatever `.bg-surface-2`
 * actually paints is what the map says it paints.
 */
export function buildClassColorMaps(css) {
  const bg = new Map(), fg = new Map();
  const VAL = '(#[0-9a-fA-F]{3,8}|rgba?\\([^)]*\\))';
  const CLS = '\\.((?:[a-zA-Z0-9_-]|\\\\.)+)(?:::?[a-zA-Z-]+)?\\s*\\{[^}]*?';
  for (const m of css.matchAll(new RegExp(`${CLS}background(?:-color)?:\\s*${VAL}`, 'g'))) {
    const name = m[1].replace(/\\/g, '');
    if (!bg.has(name)) bg.set(name, m[2]);
  }
  for (const m of css.matchAll(new RegExp(`${CLS}(?<![a-z-])color:\\s*${VAL}`, 'g'))) {
    const name = m[1].replace(/\\/g, '');
    if (!fg.has(name)) fg.set(name, m[2]);
  }
  const vars = new Map([...css.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/g)]
    .map((m) => [m[1], m[2]]));
  return { bg, fg, vars };
}

/** Nearest ancestor with a resolvable background — the ground this element is actually painted on. */
export function resolveGround(node, nodes, bgMap, varMap) {
  for (let i = node.ancestors.length - 1; i >= 0; i--) {
    const a = nodes[node.ancestors[i]];
    const hits = [...a.cls.matchAll(/(?:^|\s)bg-([a-zA-Z0-9/[\].-]+)/g)];
    for (const m of hits.reverse()) {
      const full = `bg-${m[1]}`;
      if (bgMap.has(full)) return bgMap.get(full);
      const token = m[1].split('/')[0];
      if (varMap.has(token)) return varMap.get(token);
    }
  }
  return null;
}

/** Tailwind opacity modifier: `bg-secondary/5` -> 0.05, `bg-x/[0.03]` -> 0.03. */
export function opacityModifier(utility) {
  const m = String(utility).match(/\/\[?([\d.]+)\]?$/);
  if (!m) return 1;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return 1;
  return n > 1 ? n / 100 : n;
}

/** Marketing routes — the pages a prospect actually judges. Blog articles and legal boilerplate are
 * SUPPOSED to be uniform, and firing there is how a gate learns to cry wolf. */
export const MARKETING_ROUTE = /^(index|services|about|contact)\.html$|^services\/[^/]+\.html$/;
