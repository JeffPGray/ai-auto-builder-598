#!/usr/bin/env node
/**
 * Email authentication DNS audit — SPF / DKIM / DMARC on your sending domain.
 *
 * Usage:
 *   node scripts/check-dns-auth.js                    # domain from EMAIL_ADDRESS in .env
 *   node scripts/check-dns-auth.js example.com        # explicit domain
 *   node scripts/check-dns-auth.js example.com --selector s1-ionos
 *
 * Prints JSON: { domain, freeProvider, checks: [...], summary }
 * Each check: { id, status: "ok"|"warn"|"fail"|"info", detail, fix? }
 *
 * ── Read this before trusting the DKIM result ──────────────────────────
 * DNS alone CANNOT prove DKIM is absent. A DKIM key lives at
 * <selector>._domainkey.<domain>, and the selector is chosen by your mail
 * provider — it is not discoverable from DNS. We sweep the selectors used
 * by the major providers, but real ones routinely fall outside that list:
 * IONOS signs with `s1-ionos` (a CNAME to s1.dkim.ionos.com), which no
 * generic sweep would guess.
 *
 * So a DKIM miss here is reported as "unknown", never as a failure. The
 * only way to know for certain is to send a message and read the verdict
 * the receiving server stamps on it — that is what
 * `scripts/check-live-auth.py` does, and it reports the selector it saw.
 * Feed that back in with --selector to inspect the actual record.
 */

const dns = require("dns").promises;
const fs = require("fs");
const path = require("path");

// ── .env loading (same convention as scripts/gmail.py) ──────────────────
function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (!(k in process.env)) process.env[k] = v;
  }
}
// Only when run as a script: requiring this module (the test suite does)
// must not mutate process.env from a project's .env.
if (require.main === module) loadEnv();

/**
 * Domains where the operator sends from somebody else's infrastructure.
 * SPF/DKIM/DMARC for these belong to the provider, always pass, and cannot
 * be changed by the operator — so auditing them tells them nothing.
 */
const FREE_PROVIDERS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk",
  "live.com", "live.co.uk", "msn.com", "yahoo.com", "yahoo.co.uk", "ymail.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "gmx.com", "gmx.net", "gmx.de",
  "proton.me", "protonmail.com", "pm.me", "zoho.com", "mail.com", "yandex.com",
  // Klaudius is region-agnostic, so the big non-US consumer providers matter:
  // web.de and gmx.de are the two largest German consumer mailboxes.
  "web.de", "t-online.de", "orange.fr", "free.fr", "libero.it", "virgilio.it",
  "bt.com", "btinternet.com", "sky.com", "virginmedia.com", "outlook.co.uk",
]);

/**
 * Selectors worth sweeping, keyed by a substring of EMAIL_SMTP_HOST so we
 * try the operator's own provider first. `generic` always runs too.
 *
 * This list is a convenience, NOT an authority — see the header comment.
 */
const SELECTORS_BY_HOST = {
  "google": ["google", "google2"],
  "gmail": ["google", "google2"],
  "outlook": ["selector1", "selector2"],
  "office365": ["selector1", "selector2"],
  "microsoft": ["selector1", "selector2"],
  "fastmail": ["fm1", "fm2", "fm3"],
  "zoho": ["zoho", "zmail"],
  "ionos": ["s1-ionos", "s2-ionos", "s1", "s2"],
  "1and1": ["s1-ionos", "s2-ionos"],
  "mail.me.com": ["sig1"],
  "icloud": ["sig1"],
};
const GENERIC_SELECTORS = [
  "default", "dkim", "mail", "s1", "s2", "k1", "k2", "selector1", "selector2",
  "google", "sig1", "smtp", "key1", "mx", "email", "fm1", "fm2", "fm3",
  "s1-ionos", "s2-ionos", "zoho",
];

const out = [];
const add = (id, status, detail, fix) => out.push({ id, status, detail, ...(fix ? { fix } : {}) });

/** resolveTxt follows CNAME delegation, which DMARC and DKIM records
 *  commonly use (IONOS delegates both). Never use resolveCname here.
 *
 *  Returns {records, error}. Distinguishing "this name has no TXT record"
 *  from "the lookup failed" is essential: collapsing both to an empty array
 *  makes a transient SERVFAIL or timeout indistinguishable from a missing
 *  SPF record, and we then tell the operator to publish a record they
 *  already have. Only ENODATA/ENOTFOUND mean genuinely absent. */
async function txt(name) {
  try {
    return { records: (await dns.resolveTxt(name)).map((chunks) => chunks.join("")), error: null };
  } catch (e) {
    const code = e && e.code;
    if (code === "ENODATA" || code === "ENOTFOUND") return { records: [], error: null };
    return { records: [], error: code || "lookup failed" };
  }
}

/** Mechanism names in an SPF record, qualifiers and values stripped. Used for
 *  both lookup counting and `all` detection — a substring regex over the raw
 *  record matches inside hostnames (`include:spf-all.example.com`). */
function spfMechanisms(rec) {
  return rec
    .split(/\s+/)
    .map((tok) => tok.replace(/^[+\-~?]/, "").split(/[:=/]/)[0].toLowerCase());
}

/** Mechanisms that cost a DNS lookup. SPF permerrors above 10 of them. */
const LOOKUP_MECHANISMS = ["include", "a", "mx", "ptr", "exists", "redirect"];

/** The `all` mechanism token (with its qualifier) or null. Token-based so it
 *  can't match inside a hostname like include:spf-all.example.com. */
function spfAllToken(rec) {
  return rec.split(/\s+/).find((t) => t.replace(/^[+\-~?]/, "").toLowerCase() === "all") || null;
}

function countSpfLookups(rec) {
  return spfMechanisms(rec).filter((name) => LOOKUP_MECHANISMS.includes(name)).length;
}

/** Read a DMARC tag value. Anchored deliberately: an unanchored /p=/ also
 *  matches inside `sp=`, which reports a p=reject domain as p=none and leads
 *  to advice that would downgrade their enforcement. */
function dmarcTag(rec, tag) {
  const m = rec.match(new RegExp(`(?:^|[;\\s])${tag}=(\\w+)`));
  return m ? m[1] : null;
}

/** Multi-part public suffixes we need so the DMARC organisational-domain walk
 *  stops in the right place. Not the full PSL — just enough that co.uk and
 *  friends don't get walked past into a bare suffix. */
const MULTI_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "net.uk", "sch.uk", "ac.uk", "gov.uk",
  "com.au", "net.au", "org.au", "co.nz", "net.nz", "org.nz", "co.za", "org.za",
  "com.br", "com.mx", "com.ar", "com.co", "com.pe", "com.ve", "com.uy",
  "co.jp", "or.jp", "ne.jp", "ac.jp", "co.kr", "or.kr", "com.cn", "com.tw", "com.hk",
  "co.in", "net.in", "org.in", "com.sg", "com.my", "co.th", "com.ph", "co.id", "com.vn",
  "co.il", "com.tr", "com.pl", "com.ua", "com.ru", "com.ng", "com.eg", "co.ke",
  "com.es", "com.pt", "com.gr", "com.cy", "co.at", "or.at", "co.ma",
]);

/** True for a bare registry suffix — "com", "uk", "co.uk". Never a domain
 *  anyone can publish DMARC at, so the walk must stop before reaching one.
 *  Normalises first: this is exported, so it can be called with input main()
 *  hasn't already lowercased. */
function isPublicSuffix(d) {
  const parts = normaliseDomain(d).split(".");
  if (parts.length === 1) return true;
  return parts.length === 2 && MULTI_PART_SUFFIXES.has(parts.join("."));
}

function normaliseDomain(d) {
  return String(d || "").trim().toLowerCase().replace(/\.+$/, "");
}

/** The organisational domain DMARC falls back to: the registrable domain, i.e.
 *  one label above the public suffix.
 *
 *  RFC 7489 §6.6.3 consults exactly TWO names — the domain itself, then the
 *  organisational domain. It does NOT walk every intermediate label, so nor do
 *  we: reporting "inherited from b.example.com" would name a domain no real
 *  receiver would have consulted. Returns [] when `domain` already IS the
 *  organisational domain (nothing further to try). */
function parentDomains(domain) {
  const parts = normaliseDomain(domain).split(".").filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    const candidate = parts.slice(i).join(".");
    if (isPublicSuffix(candidate)) {
      // One label back up is the registrable domain.
      const org = parts.slice(i - 1).join(".");
      return org === normaliseDomain(domain) ? [] : [org];
    }
  }
  return [];
}

async function main() {
  const args = process.argv.slice(2);
  const selIdx = args.indexOf("--selector");
  const knownSelector = selIdx !== -1 ? args[selIdx + 1] : null;
  // Guard the -1 case: without --selector, selIdx+1 is 0, which would drop
  // the first positional argument (the domain) on the floor.
  const selValueIdx = selIdx === -1 ? -1 : selIdx + 1;
  const positional = args.filter((a, i) => !a.startsWith("--") && i !== selValueIdx);

  const address = (process.env.EMAIL_ADDRESS || "").trim();
  const domain = (positional[0] || (address.includes("@") ? address.split("@")[1] : "")).toLowerCase();

  if (!domain) {
    console.error("No domain. Set EMAIL_ADDRESS in .env or pass one: node scripts/check-dns-auth.js example.com");
    process.exit(1);
  }

  // ── Free provider short-circuit ───────────────────────────────────────
  if (FREE_PROVIDERS.has(domain)) {
    add("provider", "info",
      `You send from ${domain}, so SPF, DKIM and DMARC are ${domain}'s records, not yours. ` +
      `They pass by definition and there is nothing for you to configure or fix.`);
    add("tradeoff", "info",
      `Two things you give up: you build no sending reputation of your own, and a ${domain} ` +
      `address reads as less established to a business owner than you@yourcompany.com.`);
    add("custom-domain", "info",
      `If you are weighing up a custom domain, know the trade honestly: a brand-new domain starts ` +
      `with NO reputation, which is worse than ${domain}'s, not better. It is a credibility upgrade ` +
      `with a short-term deliverability cost. If you move, send low volume for the first couple of ` +
      `weeks and let it build rather than starting at full pace on day one.`);
    return report(domain, true);
  }

  // ── MX ────────────────────────────────────────────────────────────────
  // ENOTFOUND means the domain itself doesn't exist (NXDOMAIN), as opposed to
  // ENODATA which means it exists but publishes no MX. Without the distinction
  // we'd print three failures and tell the operator to add SPF/DKIM/DMARC
  // records to a domain that isn't registered — confidently wrong advice on
  // what is almost always a typo or an expired domain.
  let mx = [];
  let mxErr = null;
  try { mx = await dns.resolveMx(domain); } catch (e) { mxErr = e.code; }

  if (mxErr === "ENOTFOUND" || mxErr === "NXDOMAIN") {
    add("domain", "fail", `${domain} does not resolve — there is no such domain in DNS.`,
      "Check the spelling of EMAIL_ADDRESS in .env. If the domain is yours and this is unexpected, " +
      "it may have expired — check with your registrar.");
    return report(domain, false);
  }

  // RFC 7505 "null MX": a single MX whose exchange is the root (`.`, which Node
  // surfaces as an empty string) is a positive declaration that the domain
  // handles no mail at all. Counting it as a valid MX would report a green tick
  // on a domain that cannot receive anything.
  const realMx = mx.filter((r) => r.exchange && r.exchange !== ".");

  if (mx.length > 0 && realMx.length === 0) {
    add("mx", "fail", `${domain} publishes a null MX record, which declares that it handles no mail.`,
      "If you send outreach from this domain, point its MX at your mail provider.");
  } else if (realMx.length === 0) {
    add("mx", "fail", `No MX records for ${domain} — this domain cannot receive mail.`,
      "Point MX at your mail provider before anything else here matters.");
  } else {
    add("mx", "ok", `${realMx.length} MX record(s): ${realMx.map((r) => r.exchange).join(", ")}`);
  }

  // ── SPF ───────────────────────────────────────────────────────────────
  const apexRes = await txt(domain);
  const spf = apexRes.records.filter((r) => r.toLowerCase().startsWith("v=spf1"));

  if (apexRes.error) {
    add("spf", "unknown_to_warn",
      `Could not read TXT records for ${domain} (${apexRes.error}). That is a failed DNS lookup, ` +
      `not a missing record — this check cannot tell you anything about SPF right now.`,
      "Re-run in a moment. If it keeps failing, your DNS provider or resolver is the place to look.");
  } else if (spf.length === 0) {
    add("spf", "fail", "No SPF record found.",
      `Add a TXT record at ${domain} authorising your provider, e.g. "v=spf1 include:<provider> ~all". ` +
      `Your provider's docs give the exact include: value.`);
  } else if (spf.length > 1) {
    add("spf", "fail",
      `${spf.length} SPF records found. More than one is a permanent error — SPF stops working entirely, ` +
      `it does not merge.`,
      `Delete all but one and combine their include: mechanisms into that single record.`);
  } else {
    const rec = spf[0];
    const notes = [];
    const mechs = spfMechanisms(rec);
    const allTok = spfAllToken(rec);

    if (allTok) {
      if (allTok.startsWith("+") || allTok.toLowerCase() === "all") {
        notes.push("`+all` authorises the entire internet to send as you — effectively no protection");
      } else if (allTok.startsWith("?")) {
        notes.push("`?all` is neutral and gives you no protection");
      }
    } else if (!mechs.includes("redirect")) {
      // A `redirect=` record must NOT carry `all` (RFC 7208 §6.1) — the redirect
      // is ignored if it does. Warning about a missing `all` here would push the
      // operator into breaking a perfectly valid record.
      notes.push("no `all` mechanism — the record has no default, which is ambiguous to receivers");
    }
    // SPF permerrors above 10 DNS-querying mechanisms. Count by tokenising and
    // reading each mechanism NAME — a regex alternation over the bare names
    // silently matches the `a` inside `~all` (and inside any hostname starting
    // with "a"), which over-counts every record and would flag a legal
    // 10-lookup record as an 11-lookup error.
    // Only counts this record's own mechanisms; nested includes resolve to more
    // lookups and can push a record that looks fine here over the real limit.
    const lookups = countSpfLookups(rec);
    if (lookups > 10) notes.push(`${lookups} DNS-lookup mechanisms — the limit is 10, above which SPF permerrors`);

    if (notes.length) {
      add("spf", "warn", `SPF present but: ${notes.join("; ")}.\n    ${rec}`,
        "`~all` (softfail) is the right ending for most senders; `-all` once you are confident every sending source is listed.");
    } else {
      add("spf", "ok", `Single valid SPF record.\n    ${rec}`);
    }
  }

  // ── DKIM ──────────────────────────────────────────────────────────────
  const smtpHost = (process.env.EMAIL_SMTP_HOST || "").toLowerCase();
  const providerSelectors = Object.entries(SELECTORS_BY_HOST)
    .filter(([k]) => smtpHost.includes(k))
    .flatMap(([, v]) => v);
  const candidates = [...new Set([...(knownSelector ? [knownSelector] : []), ...providerSelectors, ...GENERIC_SELECTORS])];

  // Run the sweep concurrently. Sequentially, a single selector whose
  // authoritative nameserver times out stalls the whole check for ~45s, and
  // there are 20+ of them.
  const swept = await Promise.all(candidates.map(async (sel) => {
    const { records, error } = await txt(`${sel}._domainkey.${domain}`);
    const key = records.find((r) => /v=DKIM1|p=[A-Za-z0-9+/]/.test(r));
    return key ? { selector: sel, record: key } : (error ? { selector: sel, error } : null);
  }));
  const hits = swept.filter((h) => h && !h.error);
  // A SERVFAIL on the selector that holds the live key must not read as
  // "absent" — that is the same collapse txt() exists to prevent.
  const sweepErrors = swept.filter((h) => h && h.error).length;

  // If the caller named a selector and it isn't among the hits, say so even
  // when other selectors matched. The whole point of --selector is to inspect
  // one specific key; silently reporting a different one hides the mismatch.
  if (knownSelector && !hits.some((h) => h.selector === knownSelector)) {
    add("dkim-selector", "fail",
      `No DKIM key at the selector you supplied: \`${knownSelector}._domainkey.${domain}\`.`,
      "Check the spelling, or re-run `python3 scripts/check-live-auth.py` to see the selector actually signing your mail.");
  }

  // An empty `p=` is NOT automatically a revoked key. Providers publish empty
  // selectors as rotation placeholders per the DKIM rotation BCP — Fastmail
  // ships fm1/fm2/fm3 that way, with only the active one carrying a key.
  // Calling those "revoked" would be a confident misdiagnosis of a healthy
  // domain, so an empty selector only matters when NO live key exists at all.
  const live = hits.filter((h) => !/(^|;)\s*p=\s*(;|$)/.test(h.record));
  const placeholders = hits.filter((h) => /(^|;)\s*p=\s*(;|$)/.test(h.record));

  if (live.length) {
    for (const h of live) {
      add("dkim", "ok", `Key found at \`${h.selector}._domainkey.${domain}\` (${h.record.length} chars).`);
    }
    if (placeholders.length) {
      add("dkim-rotation", "info",
        `${placeholders.length} further selector(s) published with an empty key ` +
        `(${placeholders.map((h) => h.selector).join(", ")}) — normal key-rotation placeholders, not a problem.`);
    }
  } else if (placeholders.length >= candidates.length) {
    // Every name we tried answered with an empty key — that is a wildcard
    // publication, which is how a domain positively declares "nothing here
    // DKIM-signs". Distinct from a couple of rotation placeholders.
    add("dkim", "warn",
      `Every selector tried returns an empty key, which is a wildcard record — the standard way a domain ` +
      `declares that it does not DKIM-sign at all.`,
      "If this domain sends your outreach, turn DKIM on in your mail provider's settings. " +
      "Confirm either way with `python3 scripts/check-live-auth.py`.");
  } else if (placeholders.length) {
    add("dkim", "unknown_to_warn",
      `Found ${placeholders.length} selector(s) (${placeholders.map((h) => h.selector).join(", ")}) but all have an ` +
      `empty key, which usually means they are rotation placeholders and the active key sits at a selector ` +
      `this script did not try.`,
      "Run `python3 scripts/check-live-auth.py` to see the selector actually signing your mail.");
  } else if (sweepErrors) {
    add("dkim", "unknown_to_warn",
      `${sweepErrors} of the ${candidates.length} selector lookups failed (DNS error), so this check ` +
      `could not determine whether DKIM is signing.`,
      "Re-run in a moment; if it persists, `python3 scripts/check-live-auth.py` settles it without DNS.");
  } else if (!knownSelector) {
    // The knownSelector-not-found case is already reported by the dkim-selector
    // check above, which also covers "you asked for X but we found Y".
    add("dkim", "unknown_to_warn",
      `No key found at any of the ${candidates.length} selectors this script knows about. ` +
      `This is NOT evidence that DKIM is off — selectors are provider-specific and frequently ` +
      `unguessable (IONOS uses \`s1-ionos\`, Google Workspace domains sometimes use dated ones).`,
      "Run `python3 scripts/check-live-auth.py` — it sends one message and reads back the verdict the " +
      "receiving server stamped, which settles this definitively and tells you the real selector.");
  }

  // ── DMARC ─────────────────────────────────────────────────────────────
  const dmarcRes = await txt(`_dmarc.${domain}`);
  let dmarc = dmarcRes.records.find((r) => r.toLowerCase().startsWith("v=dmarc1"));
  let inheritedFrom = null;

  // DMARC falls back to the organisational domain, so a subdomain sender
  // (mail.example.com, send.example.com — a mainstream setup) is covered by
  // the parent's record. Reporting "no DMARC" and handing over a `p=none`
  // record to publish would actively WEAKEN a domain whose parent is on
  // p=reject, because a subdomain record overrides the inherited policy.
  if (!dmarc) {
    for (const parent of parentDomains(domain)) {
      const res = await txt(`_dmarc.${parent}`);
      const found = res.records.find((r) => r.toLowerCase().startsWith("v=dmarc1"));
      if (found) { dmarc = found; inheritedFrom = parent; break; }
    }
  }

  if (dmarcRes.error && !dmarc) {
    add("dmarc", "unknown_to_warn",
      `Could not read the DMARC record for ${domain} (${dmarcRes.error}). That is a failed lookup, not a missing record.`,
      "Re-run in a moment before changing any DNS.");
  } else if (!dmarc) {
    add("dmarc", "fail", "No DMARC record. Google, Yahoo and Microsoft now expect one from anyone sending them mail.",
      `Add a TXT record at _dmarc.${domain} with:\n      v=DMARC1; p=none; rua=mailto:dmarc@${domain}\n` +
      `      \`p=none\` is monitor-only and changes nothing about how your mail is treated — it is the correct place to start.`);
  } else {
    // Anchor the tag match: an unanchored /p=/ also matches inside `sp=`, so a
    // record like "v=DMARC1; sp=none; p=reject" reads as p=none — and the
    // generated fix would then downgrade a rejecting domain to none.
    const policy = dmarcTag(dmarc, "p") || "none";
    const subPolicy = dmarcTag(dmarc, "sp");
    // For an inherited record it is `sp=` (subdomain policy), when present,
    // that actually governs this domain — not `p=`.
    const effective = inheritedFrom ? (subPolicy || policy) : policy;
    const hasRua = /rua=/.test(dmarc);

    const where = inheritedFrom
      ? `inherited from \`${inheritedFrom}\` (DMARC falls back to the organisational domain, so this domain is covered)`
      : null;
    const bits = [`policy \`p=${effective}\``];
    if (where) bits.push(where);
    if (!hasRua) {
      bits.push("no `rua=` — nothing is reporting, so you have zero visibility into who is sending as you or whether your own mail passes");
    }

    // Never hand a subdomain a record to publish: adding one OVERRIDES the
    // inherited policy, so "add rua" at mail.example.com would silently drop
    // a parent's p=reject down to whatever we suggested.
    const fix = hasRua
      ? undefined
      : inheritedFrom
        ? `Add the reporting address to the record at _dmarc.${inheritedFrom} — do not publish one at _dmarc.${domain}, ` +
          `since a record here would override the inherited policy.`
        : `Add a reporting address: v=DMARC1; p=${policy}; rua=mailto:dmarc@${domain}`;

    add("dmarc", hasRua ? "ok" : "warn", `${bits.join("; ")}.\n    ${dmarc}`, fix);

    if (effective === "none") {
      add("dmarc-policy", "info",
        "`p=none` is accepted today as a starting point, but the direction of travel at the big providers is " +
        "toward quarantine/reject. Move up only once reports show your legitimate mail passing.");
    }
  }

  report(domain, false);
}

function report(domain, freeProvider) {
  // "unknown_to_warn" is a deliberate internal marker: surfaced to humans as
  // UNKNOWN (we cannot prove absence) but counted as a warning, not a pass.
  const checks = out.map((c) => ({ ...c, status: c.status === "unknown_to_warn" ? "unknown" : c.status }));
  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => ["warn", "unknown"].includes(c.status)).length;

  // Exit non-zero when something actually failed, matching check-live-auth.py's
  // convention so the pair can be used from a script. Warnings are not failures.
  // process.exitCode (not process.exit) so stdout flushes first.
  process.exitCode = fails > 0 ? 1 : 0;

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ domain, freeProvider, checks, summary: { fails, warns } }, null, 2));
    return;
  }

  const icon = { ok: "✓", warn: "!", fail: "✗", info: "·", unknown: "?" };
  console.log(`\nEmail authentication — ${domain}\n`);
  for (const c of checks) {
    console.log(`  ${icon[c.status] || "·"} ${c.id.toUpperCase()}: ${c.detail}`);
    if (c.fix) console.log(`      → ${c.fix}`);
    console.log("");
  }
  if (freeProvider) console.log("Nothing to fix — see above for the trade-offs.\n");
  else if (fails === 0 && warns === 0) console.log("All checks passed.\n");
  else console.log(`${fails} failing, ${warns} needing attention.\n`);
}

// Only run when invoked as a script. Requiring this file (the test suite does)
// gets the pure helpers below without sending DNS queries or printing a report.
if (require.main === module) {
  main().catch((e) => {
    console.error("check-dns-auth failed:", e.message);
    process.exit(1);
  });
}

module.exports = { spfMechanisms, spfAllToken, parentDomains, isPublicSuffix, countSpfLookups, dmarcTag, FREE_PROVIDERS };
