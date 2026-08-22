/**
 * Media + surface contract — executable policy for Klaudius trade sites.
 *
 * Docs: services/higgsfield/IMAGE-RULES.md
 * Gate: scripts/verify-media-surface.mjs
 *
 * Numbers are deliberate (caught live on Aqua 2026-08-21):
 * - left wash ≥ 0.90 under heroes = muddy nav seam + dead photo
 * - lift-panel + left veil ≥ 0.80 = double-dark dealer fail
 * - bare surface-6 CTA = bland money band fail
 */
export const ROLES_BAN_PHOTO = Object.freeze([
  "metrics",
  "dense-copy",
  "faq",
  "spec-ledger",
]);

export const ROLES_ALLOW_HF_STILL = Object.freeze([
  "thin-shelf",
  "atmosphere-ground",
  "photo-ground",
]);

export const HERO_SOURCE = "hf-hero";
export const NEVER_STOCK = true;

/** Max hatched <section> classNames per marketing HTML page (accent, not wallpaper). */
export const HATCH_SECTIONS_MAX = 1;
/** Quiet glyphs — not every band (ATMOSPHERE.md). */
export const WATERMARK_MAX = 2;
/** Soft frost plates — not wallpaper. */
export const FROST_SECTIONS_MAX = 2;
/** Soft depth planes (frost/dark/vs/grad-frost) — not wallpaper. */
export const DEPTH_PLANE_MAX = 2;
export const COPPER_SECTIONS_MAX = 1;
export const MESH_SECTIONS_MAX = 1;
/** Loud beats: frost ∪ copper ∪ hatch ∪ go-mesh sections. */
export const LOUD_BEATS_MAX = 3;
export const SERVICE_BODY_ATMOSPHERE = "band-depth-frost";
/** Same-section mutex pairs (ATMOSPHERE.md). */
export const SECTION_MUTEX = Object.freeze([
  ["hatch", "grain"],
  ["hatch", "band-go-mesh"],
  ["band-copper-plate", "band-depth-frost"],
]);

export const MARKETING_HTML =
  /^(index|services|about|contact)\.html$|^services\/[^/]+\.html$/;
export const HERO_SPLIT_LEFT_OPACITY_MAX = 0.85;

/** Banned substrings in client/globals overlay recipes (caught as muddy). */
export const BANNED_OVERLAY_FRAGMENTS = Object.freeze([
  "0.94",
  "0.92",
  "0.90",
  "88%", // color-mix heavy left
]);

/** Classes that must exist in site globals (template contract). */
export const REQUIRED_CSS_CLASSES = Object.freeze([
  "hero-overlay",
  "hero-overlay--split",
  "lift-panel",
  "lift-panel--ink",
  "cinema-grade--dealer",
  "cta-primary",
  "cta-primary--on-ink",
  "band-go-mesh",
  "go-frame",
  "hatch",
  "band-depth-frost",
  "band-depth-dark",
  "band-vs-split",
  "band-copper-plate",
  "band-panel",
  "grad-frost",
  "band-ledge",
  "band-seam",
  "paper-tooth",
  "edge-rule",
]);

/** data-hero sections must clear fixed nav (utility class). */
export const HERO_NAV_PAD_CLASS = "pt-40";

/**
 * Money CTA: section must include at least one of these (not bare bg-surface-6).
 */
export const MONEY_CTA_MARKERS = Object.freeze([
  "band-go-mesh",
  "go-frame",
  "lift-panel--ink",
  "lift-panel",
]);

/** Both lanes share one artifact; shared/multisite requires assetPrefix derivation. */
export const SHARED_LANE_ASSET_PREFIX_MARKER = "klaudius";

/**
 * next.config.mjs must keep assetPrefix derivation for shared/multisite lane.
 * Dedicated lane clears via KLAUDIUS_ASSET_PREFIX='' at rebuild — file still has the logic.
 */
export function checkNextConfig(src) {
  const failures = [];
  const warnings = [];
  if (!/assetPrefix/.test(src)) {
    failures.push(
      "[host] next.config.mjs missing assetPrefix — shared/multisite lane will not hydrate",
    );
  } else if (!new RegExp(SHARED_LANE_ASSET_PREFIX_MARKER).test(src)) {
    warnings.push(
      "[host] assetPrefix present but no /klaudius/ derivation — confirm shared-lane path",
    );
  }
  if (!/KLAUDIUS_ASSET_PREFIX/.test(src)) {
    warnings.push(
      "[host] no KLAUDIUS_ASSET_PREFIX escape hatch — dedicated/single rebuilds need it",
    );
  }
  return { ok: failures.length === 0, failures, warnings };
}

export function assertNoBannedPhotoRoles(plan) {
  for (const slot of plan.slots || []) {
    if (ROLES_BAN_PHOTO.includes(slot.role) && slot.source && slot.source !== "none") {
      throw new Error(`banned photo role=${slot.role} slot=${slot.id} source=${slot.source}`);
    }
    if (
      slot.source === "hf-still" &&
      !ROLES_ALLOW_HF_STILL.includes(slot.role) &&
      slot.role !== "photo-ground"
    ) {
      throw new Error(`hf-still not allowed for role=${slot.role} slot=${slot.id}`);
    }
  }
}

/**
 * Parse rgba/opacity-ish left wash heaviness from a CSS background blob.
 * Returns max opacity found in 0.xx tokens, or null.
 */
export function maxOpacityToken(cssChunk) {
  let max = null;
  for (const m of cssChunk.matchAll(/\b0\.(\d{2})\b/g)) {
    const v = Number(`0.${m[1]}`);
    if (max === null || v > max) max = v;
  }
  for (const m of cssChunk.matchAll(/rgba?\([^)]*?,\s*(0?\.\d+)\s*\)/g)) {
    const v = Number(m[1]);
    if (max === null || v > max) max = v;
  }
  // color-mix(in oklch, var(--surface-dark) 88%, transparent) → 0.88
  for (const m of cssChunk.matchAll(
    /color-mix\([^)]*?var\(--surface-dark\)\s+(\d{1,3})%\s*,\s*transparent/g,
  )) {
    const v = Number(m[1]) / 100;
    if (max === null || v > max) max = v;
  }
  return max;
}

export function extractRuleBody(css, className) {
  const re = new RegExp(
    `\\.${className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]+)\\}`,
    "m",
  );
  const m = css.match(re);
  return m ? m[1] : null;
}

/**
 * @returns {{ ok: boolean, failures: string[], warnings: string[] }}
 */
export function checkGlobalsCss(css) {
  const failures = [];
  const warnings = [];

  for (const cls of REQUIRED_CSS_CLASSES) {
    if (!css.includes(`.${cls}`)) {
      failures.push(`[contract] missing .${cls} in globals.css — copy from templates/trade-site`);
    }
  }

  const splitBody = extractRuleBody(css, "hero-overlay--split") || "";
  const splitMax = maxOpacityToken(splitBody);
  if (splitMax !== null && splitMax > HERO_SPLIT_LEFT_OPACITY_MAX) {
    failures.push(
      `[overlay] .hero-overlay--split max opacity ${splitMax} > ${HERO_SPLIT_LEFT_OPACITY_MAX} ` +
        `(muddy hero / hard nav seam). Soften left wash.`,
    );
  }
  for (const frag of BANNED_OVERLAY_FRAGMENTS) {
    if (splitBody.includes(frag)) {
      failures.push(`[overlay] .hero-overlay--split contains banned fragment "${frag}"`);
    }
  }

  const dealerBody = extractRuleBody(css, "cinema-grade--dealer") || "";
  if (dealerBody && /90deg|to right|105deg/.test(dealerBody)) {
    const dMax = maxOpacityToken(dealerBody);
    if (dMax !== null && dMax >= 0.8) {
      failures.push(
        `[dealer] .cinema-grade--dealer paints a heavy left wash (opacity ${dMax}) — ` +
          `letterbox blend only; lift-panel owns copy`,
      );
    }
  }

  const railH = extractRuleBody(css, "signature-spine__rail--h") || "";
  if (railH && /right:\s*1\.25rem/.test(railH) && !/width:\s*min\(/.test(railH)) {
    warnings.push(
      `[spine] .signature-spine__rail--h spans full section (right:1.25rem) — cap width so copper does not bleed`,
    );
  }

  return { ok: failures.length === 0, failures, warnings };
}

/**
 * Scan page TSX sources for surface composition fails.
 * @param {{ path: string, src: string }[]} pages
 */
export function checkPageSources(pages) {
  const failures = [];
  const warnings = [];

  for (const { path: p, src } of pages) {
    if (/data-hero/.test(src) && /photo-ground|HeroVideo/.test(src)) {
      const isHomeVideo = /HeroVideo/.test(src) && /minHeight:\s*["']100svh["']/.test(src);
      if (!isHomeVideo && !src.includes(HERO_NAV_PAD_CLASS) && !/pt-40|pt-36|pt-\[/.test(src)) {
        failures.push(
          `[nav] ${p}: [data-hero] missing ${HERO_NAV_PAD_CLASS} (fixed nav clearance)`,
        );
      }
    }

    if (/lift-panel--ink/.test(src) && /cinema-grade(?!--dealer)/.test(src.replace(/cinema-grade--dealer/g, ""))) {
      if (/className="[^"]*cinema-grade[^"]*"/.test(src) && !/cinema-grade--dealer/.test(src)) {
        warnings.push(
          `[dealer] ${p}: lift-panel--ink with generic .cinema-grade — prefer cinema-grade--dealer (letterbox only)`,
        );
      }
    }

    const moneyCopy =
      /Prefer to call|Get (a |your )?quote|Call now|Ready to|Questions about your|Talk to the .{0,40}(team|people)|Contact .{0,40}team/i;
    for (const m of src.matchAll(/<section\b([^>]*)>([\s\S]*?)<\/section>/g)) {
      const attrs = m[1];
      const body = m[2];
      if (/\bdata-hero\b/.test(attrs)) continue;
      if (!/cta-primary/.test(body)) continue;
      if (!moneyCopy.test(body)) continue;
      const blob = attrs + body;
      if (!MONEY_CTA_MARKERS.some((marker) => blob.includes(marker))) {
        failures.push(
          `[cta] ${p}: money CTA section lacks band-go-mesh / go-frame / lift-panel — not bare bg-surface-6`,
        );
      }
    }

    if (/measured-veil|systems-veil/.test(src) && /opacity-|photo-ground-wash/.test(src)) {
      warnings.push(`[veil] ${p}: thin veil file referenced — confirm not under dense metrics copy`);
    }

    const isServiceDetail = /[/\\]services[/\\][^/\\]+[/\\]page\.tsx$/.test(p.replace(/\\/g, "/"));
    if (isServiceDetail) {
      if (!/photo-ground/.test(src) && !/ServiceDetailFrame/.test(src)) {
        failures.push(
          `[service] ${p}: missing photo-ground hero — use ServiceDetailFrame (no flat grad-only)`,
        );
      }
      if (!/ServiceDetailFrame/.test(src) && !new RegExp(SERVICE_BODY_ATMOSPHERE).test(src)) {
        failures.push(
          `[service] ${p}: missing ${SERVICE_BODY_ATMOSPHERE} — ServiceDetailFrame frost forever`,
        );
      }
      if (/\bhatch\b/.test(src) && !/ServiceDetailFrame/.test(src)) {
        failures.push(`[service] ${p}: hatch banned on service detail — frost body only`);
      }
      if (/band-go-mesh/.test(src)) {
        failures.push(`[service] ${p}: band-go-mesh banned on service detail — closer is home/contact`);
      }
      if (/grad-lake|grad-frost/.test(src) && !/photo-ground/.test(src) && !/ServiceDetailFrame/.test(src)) {
        failures.push(
          `[service] ${p}: legacy flat gradient hero without photo-ground — rewrite via ServiceDetailFrame`,
        );
      }
    }

    const sectionAttrs = [];
    for (const m of src.matchAll(/<section\b([^>]*)>/g)) {
      const cm = m[1].match(/className="([^"]*)"/);
      sectionAttrs.push({ attrs: m[1], cls: cm ? cm[1] : m[1] });
    }

    let hatchSections = 0;
    let meshSections = 0;
    let frostSections = 0;
    let copperSections = 0;
    let loudBeats = 0;
    for (const { attrs, cls } of sectionAttrs) {
      const hasHatch = /\bhatch\b/.test(cls);
      const hasMesh = /\bband-go-mesh\b/.test(cls);
      const hasFrost = /\bband-depth-frost\b/.test(cls);
      const hasCopper = /\bband-copper-plate\b/.test(cls);
      if (hasHatch) hatchSections++;
      if (hasMesh) meshSections++;
      if (hasFrost) frostSections++;
      if (hasCopper) copperSections++;
      if (hasHatch || hasMesh || hasFrost || hasCopper) loudBeats++;
      if (/\bdata-hero\b/.test(attrs) && hasHatch) {
        failures.push(`[atmosphere] ${p}: hatch on data-hero — texture banned on photo plane`);
      }
      for (const [a, b] of SECTION_MUTEX) {
        const reA = new RegExp(`\\b${a}\\b`);
        const reB = new RegExp(`\\b${b}\\b`);
        if (reA.test(cls) && reB.test(cls)) {
          failures.push(`[atmosphere] ${p}: mutex ${a}+${b} on one section`);
        }
      }
    }

    if (hatchSections > HATCH_SECTIONS_MAX) {
      failures.push(
        `[atmosphere] ${p}: ${hatchSections} hatched sections — ≤${HATCH_SECTIONS_MAX}/page`,
      );
    }
    if (meshSections > MESH_SECTIONS_MAX) {
      failures.push(`[cta] ${p}: ${meshSections} band-go-mesh — ≤${MESH_SECTIONS_MAX}/page`);
    }
    if (frostSections > FROST_SECTIONS_MAX) {
      failures.push(
        `[atmosphere] ${p}: ${frostSections} band-depth-frost — ≤${FROST_SECTIONS_MAX}/page`,
      );
    }
    if (copperSections > COPPER_SECTIONS_MAX) {
      failures.push(
        `[atmosphere] ${p}: ${copperSections} band-copper-plate — ≤${COPPER_SECTIONS_MAX}/page`,
      );
    }
    if (loudBeats > LOUD_BEATS_MAX) {
      failures.push(
        `[atmosphere] ${p}: ${loudBeats} loud beats — ≤${LOUD_BEATS_MAX} (frost/copper/hatch/mesh)`,
      );
    }

    const wmCount = (src.match(/className="[^"]*\bwatermark\b[^"]*"/g) || []).length;
    if (wmCount > WATERMARK_MAX) {
      failures.push(`[atmosphere] ${p}: ${wmCount} watermarks — ≤${WATERMARK_MAX}/page`);
    }

    const depthPlanes =
      (src.match(/band-depth-frost|band-depth-dark|band-vs-split|grad-frost/g) || []).length;
    if (depthPlanes > DEPTH_PLANE_MAX) {
      warnings.push(
        `[atmosphere] ${p}: ${depthPlanes} depth planes — prefer ≤${DEPTH_PLANE_MAX}`,
      );
    }
  }

  return { ok: failures.length === 0, failures, warnings };
}

/**
 * Built HTML atmosphere — measure out/, not intent (Blue Water stale-out incident).
 * @param {{ path: string, html: string }[]} pages
 */
export function checkBuiltPages(pages) {
  const failures = [];
  const warnings = [];

  for (const { path: p, html } of pages) {
    const rel = p.replace(/\\/g, "/");
    const base = rel.includes("/") ? rel.split("/").slice(-2).join("/") : rel.split("/").pop();
    const leaf = rel.split("/").pop();
    if (!MARKETING_HTML.test(leaf) && !MARKETING_HTML.test(base)) continue;

    let hatchSections = 0;
    let meshSections = 0;
    let frostSections = 0;
    let copperSections = 0;
    let loudBeats = 0;
    for (const m of html.matchAll(/<section\b([^>]*)>/gi)) {
      const attrs = m[1];
      const hasHatch = /\bhatch\b/.test(attrs);
      const hasMesh = /\bband-go-mesh\b/.test(attrs);
      const hasFrost = /\bband-depth-frost\b/.test(attrs);
      const hasCopper = /\bband-copper-plate\b/.test(attrs);
      if (hasHatch) hatchSections++;
      if (hasMesh) meshSections++;
      if (hasFrost) frostSections++;
      if (hasCopper) copperSections++;
      if (hasHatch || hasMesh || hasFrost || hasCopper) loudBeats++;
      for (const [a, b] of SECTION_MUTEX) {
        const reA = new RegExp(`\\b${a}\\b`);
        const reB = new RegExp(`\\b${b}\\b`);
        if (reA.test(attrs) && reB.test(attrs)) {
          failures.push(`[atmosphere] ${leaf}: mutex ${a}+${b} in built HTML`);
        }
      }
    }
    if (hatchSections > HATCH_SECTIONS_MAX) {
      failures.push(
        `[atmosphere] ${leaf}: ${hatchSections} hatched sections — ≤${HATCH_SECTIONS_MAX}`,
      );
    }
    if (meshSections > MESH_SECTIONS_MAX) {
      failures.push(`[cta] ${leaf}: ${meshSections} band-go-mesh — ≤${MESH_SECTIONS_MAX}`);
    }
    if (frostSections > FROST_SECTIONS_MAX) {
      failures.push(`[atmosphere] ${leaf}: ${frostSections} frost — ≤${FROST_SECTIONS_MAX}`);
    }
    if (copperSections > COPPER_SECTIONS_MAX) {
      failures.push(`[atmosphere] ${leaf}: ${copperSections} copper — ≤${COPPER_SECTIONS_MAX}`);
    }
    if (loudBeats > LOUD_BEATS_MAX) {
      failures.push(`[atmosphere] ${leaf}: ${loudBeats} loud beats — ≤${LOUD_BEATS_MAX}`);
    }
    const wmBuilt = (html.match(/class="[^"]*\bwatermark\b[^"]*"/g) || []).length;
    if (wmBuilt > WATERMARK_MAX) {
      failures.push(`[atmosphere] ${leaf}: ${wmBuilt} watermarks — ≤${WATERMARK_MAX}`);
    }

    const isServiceDetail = /^services\/[^/]+\.html$/.test(leaf) || /^services\/[^/]+\.html$/.test(base);
    if (isServiceDetail) {
      if (!/\bphoto-ground\b/.test(html)) {
        failures.push(`[service] ${leaf}: missing photo-ground`);
      }
      if (!new RegExp(`\\b${SERVICE_BODY_ATMOSPHERE}\\b`).test(html)) {
        failures.push(`[service] ${leaf}: missing ${SERVICE_BODY_ATMOSPHERE} (frost forever)`);
      }
      if (/\bhatch\b/.test(html) && /<section[^>]*\bhatch\b/.test(html)) {
        failures.push(`[service] ${leaf}: hatch banned on service detail`);
      }
      // count hatch on sections only
      let svcHatch = 0;
      for (const m of html.matchAll(/<section\b([^>]*)>/gi)) {
        if (/\bhatch\b/.test(m[1])) svcHatch++;
      }
      if (svcHatch > 0) {
        failures.push(`[service] ${leaf}: ${svcHatch} hatched section(s) — frost only`);
      }
      if (meshSections > 0) {
        failures.push(`[service] ${leaf}: band-go-mesh banned on service detail`);
      }
    }
  }

  return { ok: failures.length === 0, failures, warnings };
}

/**
 * image-plan.json structural check
 */
export function checkImagePlan(plan) {
  const failures = [];
  try {
    assertNoBannedPhotoRoles(plan);
  } catch (e) {
    failures.push(`[plan] ${e.message}`);
  }
  if (!plan.slots?.length) {
    failures.push("[plan] image-plan.json has no slots");
  }
  const hero = (plan.slots || []).find((s) => s.role === "hero-video" || s.id === "hero");
  if (hero && hero.source !== "hf-hero" && hero.source !== "none") {
    failures.push(`[plan] hero slot source=${hero.source} — expected hf-hero`);
  }
  return { ok: failures.length === 0, failures, warnings: [] };
}
