#!/usr/bin/env node
/**
 * Booking-platform golden check — booking-mode qualification gate
 *
 * Usage:
 *   node scripts/booking-check.js "https://www.fresha.com/a/some-salon-town-street-abc12def"
 *
 * Classifies a business's Google-listed website URL against the shipped
 * booking-platform registry (scripts/booking-platforms.json). Pure URL
 * classification — no network calls, deterministic, instant. Prints JSON:
 *   { url, verdict, platform?, platform_name?, classification?,
 *     fee_line_allowed?, fee_line_notes?, matched?, note? }
 *
 * Verdicts:
 *   "booking_platform"       — a booking platform's per-business page (QUALIFIES as a
 *                              booking-mode lead; platform + fee-line fields included).
 *                              weak_embed_first platforms qualify too but carry a note:
 *                              most of their customers ALSO have a real website, so the
 *                              GBP link itself is the qualifying fact — don't extrapolate.
 *   "dead_platform"          — the platform itself shut down (QUALIFIES, premium: the
 *                              business's listed website is a broken link)
 *   "unclaimed_or_directory" — an unclaimed listing or marketplace directory/search page
 *                              (does NOT qualify as a booking lead: the business is NOT
 *                              paying this platform. An unclaimed-listing business behaves
 *                              like a no-website business — classic rules apply)
 *   "disqualified_platform"  — enterprise platform used by chains (skip the lead)
 *   "aggregator_listing"     — aggregator marketplace page (not their booking backend;
 *                              does not qualify)
 *   "has_website_platform"   — platform that implies a real owned website (treat the
 *                              business as has-website)
 *   "social_as_website"      — the listed "website" is a social profile (Instagram,
 *                              Facebook, Linktree...): no real website. Treat as a
 *                              no-website candidate; record the profile as a contact field
 *   "not_booking_platform"   — no registry match (fall through to the other streams)
 *   "unparseable"            — input could not be parsed as a URL (does not qualify)
 *   "unknown_classification" — malformed registry entry; fails closed (does not qualify)
 *
 * Never qualify a lead on any verdict other than booking_platform / dead_platform,
 * and never override a verdict by eye — if the registry is wrong, fix the registry.
 */

const path = require("path");

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/booking-check.js "https://example.com"');
  process.exit(1);
}

const REGISTRY = require(path.join(__dirname, "booking-platforms.json"));

// Social redirect wrappers hide the real target in a query param. Unwrap before
// matching, else a square.site behind an Instagram linkshim classifies as social.
function unwrap(raw) {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    // Dedicated shim hosts wrap regardless of path (live shapes: l.facebook.com/l.php?u=,
    // l.instagram.com/?u=); instagram.com proper only via its /linkshim path.
    const shimHost = host === "l.facebook.com" || host === "lm.facebook.com" || host === "l.instagram.com";
    const igLinkshim = host.endsWith("instagram.com") && u.pathname.startsWith("/linkshim");
    if (shimHost || igLinkshim) {
      const target = u.searchParams.get("u");
      if (target) return unwrap(decodeURIComponent(target));
    }
    return raw;
  } catch {
    return raw;
  }
}

// A GBP "website" that is really a social profile = no real website (validated
// lead shape in live piloting). Bare host roots and profile paths both count.
const SOCIAL_HOSTS =
  /(^|\.)(instagram\.com|facebook\.com|m\.facebook\.com|fb\.com|linktr\.ee|beacons\.ai|tiktok\.com|x\.com|twitter\.com|wa\.me|api\.whatsapp\.com|linkin\.bio|allmylinks\.com)$/i;

const VERDICT_BY_CLASSIFICATION = {
  standard: "booking_platform",
  weak_embed_first: "booking_platform",
  disqualifier: "disqualified_platform",
  aggregator_exclude: "aggregator_listing",
  dead_platform: "dead_platform",
  has_website: "has_website_platform",
};

(() => {
  // GBP fields (and operators pasting by hand) sometimes hold schemeless URLs;
  // every fingerprint is ^https?://-anchored, so normalise before matching.
  const withScheme = /^https?:\/\//i.test(url) ? url : "https://" + url.replace(/^\/+/, "");
  const target = unwrap(withScheme);
  // GBP links frequently carry tracking params (?utm_source=, ?pId=, #...) that
  // break $-anchored fingerprints, while a few legacy fingerprints REQUIRE the
  // query (?owner=, ?lid=). Match against both forms; either hit counts.
  let stripped = target;
  try {
    const u = new URL(target);
    u.search = "";
    u.hash = "";
    stripped = u.toString();
  } catch {
    /* keep raw */
  }
  const hits = (pattern) => {
    const re = new RegExp(pattern, "i");
    return re.test(target) || re.test(stripped);
  };
  const emit = (verdict, extra = {}) => {
    console.log(JSON.stringify({ url, ...(target !== url ? { unwrapped: target } : {}), verdict, ...extra }, null, 1));
    process.exit(0);
  };
  try {
    new URL(target);
  } catch {
    return emit("unparseable", { note: "could not parse as a URL — does not qualify; check the value by hand" });
  }

  try {
    if (SOCIAL_HOSTS.test(new URL(target).hostname)) {
      return emit("social_as_website", {
        note: "listed website is a social profile — no real website; record the handle in the facebook/instagram contact field",
      });
    }
  } catch {
    /* unparseable URL falls through to pattern matching */
  }

  // Excludes first: directory/search/unclaimed shapes are precise and must win
  // over any loose positive on the same host (e.g. fresha.com/lvp/ vs /a/).
  for (const p of REGISTRY.platforms) {
    for (const fp of p.exclude_fingerprints || []) {
      if (hits(fp.pattern)) {
        return emit("unclaimed_or_directory", {
          platform: p.id,
          platform_name: p.name,
          matched: fp.pattern,
          note: fp.note || "directory/unclaimed shape — business is not a paying customer of this platform",
        });
      }
    }
  }

  for (const p of REGISTRY.platforms) {
    for (const fp of p.fingerprints || []) {
      if (hits(fp.pattern)) {
        // Fail CLOSED on a classification the script doesn't know (a typo'd
        // registry edit must never mint a qualifying lead with fee fields).
        const verdict = VERDICT_BY_CLASSIFICATION[p.classification];
        if (!verdict) {
          return emit("unknown_classification", {
            platform: p.id,
            note: `registry entry has unrecognised classification "${p.classification}" — does not qualify; fix the registry`,
          });
        }
        const extra = {
          platform: p.id,
          platform_name: p.name,
          classification: p.classification,
          matched: fp.pattern,
        };
        if (verdict === "booking_platform") {
          extra.fee_line_allowed = p.fee_line_allowed;
          extra.fee_line_notes = p.fee_line_notes;
          if (p.classification === "weak_embed_first") {
            extra.note =
              "weak-embed platform: most of its customers also run a real website; this GBP link is the qualifying fact, verify no own site exists before pitching";
          }
          if (fp.note) extra.fingerprint_note = fp.note;
        } else if (fp.note || p.fee_line_notes) {
          extra.note = fp.note || p.fee_line_notes;
        }
        return emit(verdict, extra);
      }
    }
  }

  return emit("not_booking_platform", {});
})();
