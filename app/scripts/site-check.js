#!/usr/bin/env node
/**
 * Website quality check — rescue-mode qualification gate
 *
 * Usage:
 *   node scripts/site-check.js "http://www.example.co.uk/"
 *
 * Fetches a business's existing website and classifies it. Prints JSON:
 *   { verdict, signals, finalUrl, fetchedMs }
 *
 * Verdicts:
 *   "dead"         — domain/site gone (DNS NXDOMAIN, or an active refusal after apex/www retries)
 *   "bad"          — live but seriously deficient (parked/suspended page, broken TLS cert,
 *                    not mobile-friendly, ancient markup, HTTP-only, stale copyright...)
 *   "ok"           — no disqualifying signals found; NOT a rescue lead
 *   "unknown"      — fetch blocked (WAF/bot-block), timed out, or ambiguous; NEVER qualify on this
 *   "not_own_site" — URL is a social/directory/booking-platform page, not an owned website
 *
 * Only "dead" and "bad" qualify a rescue lead. A 403 or a timeout is NOT evidence of a
 * bad site (bot-blocking and slow hosting look identical to dead sites from a script).
 */

const dns = require("dns").promises;

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/site-check.js "https://example.com"');
  process.exit(1);
}

const NOT_OWN_SITE =
  /(facebook\.com|instagram\.com|linktr\.ee|whatsapp\.com|yell\.com|yelp\.|checkatrade|mybuilder|ratedpeople|trustatrader|bark\.com|nextdoor\.|google\.com|business\.site|booksy|fresha|treatwell|setmore\.com|vagaro|squareup\.com|square\.site|acuityscheduling|\.as\.me)/i;

// Deliberately narrow: registrar/host boilerplate only. Generic phrases like
// "under construction" or "holding page" appear in real business copy (builders,
// letting agents) and must NOT match. Checked against <title> + first 8KB only.
const PARKED_RE =
  /(this domain (has been registered|is (parked|for sale))|domain (is )?for sale|buy this domain|sedoparking|parked free|domain parking page|expired domain|account suspended|site (is )?suspended|website (has been )?suspended)/i;

const UA_DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function tryFetch(target, { insecure = false, timeoutMs = 15000 } = {}) {
  const out = { finalUrl: null, status: null, ms: null, html: null, err: null };
  if (insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const started = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(target, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent": UA_DESKTOP,
        Accept: "text/html,application/xhtml+xml",
        // Browsers always send this and multilingual sites content-negotiate
        // on it; the wildcard keeps non-English sites negotiable.
        "Accept-Language": "en-GB,en;q=0.9,*;q=0.6",
      },
    });
    clearTimeout(t);
    out.status = res.status;
    out.finalUrl = res.url;
    out.ms = Date.now() - started;
    if (res.ok) out.html = (await res.text()).slice(0, 400000);
  } catch (e) {
    // Dig through nested causes — undici wraps TLS failures as TypeError("fetch
    // failed") with the real code (CERT_HAS_EXPIRED, DEPTH_ZERO_SELF_SIGNED_CERT,
    // ERR_TLS_CERT_ALTNAME_INVALID...) one or two causes deep.
    // AbortError first: DOMException's legacy numeric .code (20) would win the
    // chain below and break every /abort/i test on the resulting string.
    out.err = e && e.name === "AbortError"
      ? "AbortError"
      : ((e && (e.cause?.code || e.cause?.cause?.code || e.code || e.cause?.message || e.name || e.message)) || "fetch-error").toString().slice(0, 80);
    out.ms = Date.now() - started;
  } finally {
    if (insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
  }
  return out;
}

function hostVariants(u) {
  const p = new URL(u);
  const hosts = [p.host];
  if (p.host.startsWith("www.")) hosts.push(p.host.slice(4));
  else hosts.push("www." + p.host);
  return hosts.map((h) => `${p.protocol}//${h}${p.pathname}`);
}

function staticSignals(res) {
  const signals = [];
  const html = res.html || "";
  const titleTag = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "";
  if (PARKED_RE.test(titleTag) || PARKED_RE.test(html.slice(0, 8000))) signals.push("parked-or-suspended-page");
  if (new URL(res.finalUrl).protocol === "http:") signals.push("no-https");
  if (!/<meta[^>]+name=["']?viewport/i.test(html)) signals.push("no-viewport-meta");
  const years = [...html.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})/gi)].map((m) => +m[1]);
  if (years.length) {
    const y = Math.max(...years);
    if (y <= new Date().getFullYear() - 4) signals.push(`stale-copyright-${y}`);
  }
  if (/<frameset|<frame\s/i.test(html)) signals.push("framesets");
  if (/\.swf\b|shockwave-flash/i.test(html)) signals.push("flash-content");
  if (/jquery[-.\/]1\.[0-9.]+(\.min)?\.js/i.test(html)) signals.push("jquery-1.x-era");
  if (/<font\s/i.test(html)) signals.push("font-tags");
  const tables = (html.match(/<table/gi) || []).length;
  if (tables >= 4 && signals.includes("no-viewport-meta")) signals.push("table-layout");
  if (res.ms > 9000) signals.push("very-slow-load");
  return signals;
}

function verdictFrom(signals) {
  const fatal = signals.some((s) => /parked-or-suspended/.test(s));
  const strong = signals.filter((s) => /no-viewport|no-https|stale-copyright|framesets|flash|font-tags|table-layout/.test(s)).length;
  if (fatal) return "bad";
  if (signals.includes("no-viewport-meta") && signals.length >= 2) return "bad";
  if (strong >= 3) return "bad";
  return signals.length ? "ok-minor" : "ok";
}

(async () => {
  const emit = (verdict, extra = {}) => {
    console.log(JSON.stringify({ url, verdict, ...extra }, null, 1));
    process.exit(0);
  };

  if (NOT_OWN_SITE.test(url)) return emit("not_own_site", { signals: [] });

  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return emit("unknown", { signals: ["unparseable-url"] });
  }

  // DNS first: NXDOMAIN on both apex and www is the only trustworthy "dead" without retries.
  // A transient resolver failure (EAI_AGAIN, offline machine) is NOT evidence — verdict unknown.
  const apex = host.replace(/^www\./, "");
  const resolved = await Promise.allSettled([dns.lookup(host), dns.lookup(apex === host ? "www." + apex : apex)]);
  if (resolved.every((r) => r.status === "rejected")) {
    const codes = resolved.map((r) => r.reason?.code || "");
    if (codes.includes("ENOTFOUND")) return emit("dead", { signals: ["dns-nxdomain"] });
    return emit("unknown", { signals: [`dns-error-${codes[0] || "unknown"}`] });
  }

  // Browsers auto-upgrade http:// to https:// and fall back silently
  // (HTTPS-First), so a Maps-listed http URL really means "whatever the browser
  // negotiates" — sites with HSTS may only work properly over https (seen in
  // the field: a broken port-80 backend 404ing every other request while https
  // served fine, so visitors saw a working site and the checker called it
  // dead). Probe the https upgrade first; failures there are IGNORED — no
  // cert/refusal verdicts off a protocol the listing never claimed.
  let res = null;
  let firstErr = null;
  const parsed = new URL(url);
  if (parsed.protocol === "http:" && !parsed.port) {
    // Exact host only, as Chrome does — probing www/apex siblings risks
    // adopting a dangling-www placeholder page (the listed-scheme loop below
    // still retries www/apex). Explicit ports skipped: browsers only upgrade
    // default ports. Short timeout: a host that silently drops 443 must not
    // add 15s to every find-sweep check.
    parsed.protocol = "https:";
    const up = await tryFetch(parsed.href, { timeoutMs: 6000 });
    if (up.html) res = up;
  }

  // Fetch as listed, retrying the www/apex variant before believing an error.
  // Keep the FIRST variant's error for diagnostics — the loop leaves res at the
  // last variant, whose error can differ (e.g. badssl's www wildcard is expired
  // while the primary host's cert fails for a different reason).
  if (!res) {
    for (const variant of hostVariants(url)) {
      res = await tryFetch(variant);
      firstErr = firstErr || res.err;
      if (res.html || (res.status && res.status < 500)) break;
    }
  }
  const errNote = firstErr && res.err && firstErr !== res.err ? `${firstErr} / ${res.err}` : (res.err || firstErr);

  // TLS/certificate failure = a qualifying fact in itself. A cert error happens
  // during the handshake, so the server IS up and every real visitor gets the
  // browser's full-page security warning — unlike a 403, it says nothing about
  // bots and everything about the site. Only DEFINITIVE cert codes classify
  // here (bad even with no content from the insecure peek). Weak matchers —
  // bare TLS/SSL/EPROTO, which transient protocol errors can also produce —
  // fall through to the differential path below, which demands a verified
  // re-attempt fail again before implicating the certificate.
  if (res.err && /CERT|ALTNAME|SELF_SIGNED|UNABLE_TO_VERIFY|HANDSHAKE/i.test(res.err)) {
    const insecureRes = await tryFetch(res.finalUrl || url, { insecure: true });
    const signals = ["broken-tls-cert", ...(insecureRes.html ? staticSignals(insecureRes) : [])];
    return emit("bad", { signals, finalUrl: insecureRes.finalUrl || res.finalUrl || url, fetchedMs: insecureRes.ms, note: `tls error: ${errNote}` });
  }

  // Timeouts are NOT "dead" — a merely-slow site would make the outreach claim
  // "doesn't load any more" false. Only an active refusal from a resolving host
  // is dead (ECONNRESET deliberately excluded: resets are often transient).
  if (res.err) {
    if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i.test(res.err)) {
      return emit("dead", { signals: [`unreachable-${res.err}`], note: "after apex+www retries" });
    }
    // Unrecognised failure: run the differential test before giving up. Working
    // with verification OFF where it failed ON implicates the certificate — but
    // only after a verified RE-attempt fails too. Without that confirmation, a
    // transient blip on fetch #1 plus a lucky success on the insecure fetch
    // would falsely brand a healthy site broken-cert.
    if (!/abort/i.test(res.err)) {
      const insecureRes = await tryFetch(res.finalUrl || url, { insecure: true });
      if (insecureRes.html) {
        const verifiedRetry = await tryFetch(res.finalUrl || url);
        if (verifiedRetry.html) {
          // Recovered transient — analyse the verified result like any live site.
          if (NOT_OWN_SITE.test(verifiedRetry.finalUrl)) {
            return emit("bad", { signals: ["redirects-off-domain"], finalUrl: verifiedRetry.finalUrl, fetchedMs: verifiedRetry.ms });
          }
          const signals = staticSignals(verifiedRetry);
          const v = verdictFrom(signals);
          return emit(v === "ok-minor" ? "ok" : v, { signals, finalUrl: verifiedRetry.finalUrl, fetchedMs: verifiedRetry.ms });
        }
        return emit("bad", { signals: ["broken-tls-cert", ...staticSignals(insecureRes)], finalUrl: insecureRes.finalUrl, fetchedMs: insecureRes.ms, note: `verified fetch failed twice (${res.err}); unverified succeeded` });
      }
    }
    return emit("unknown", { signals: [`fetch-failed-${res.err}`], note: "timeout/ambiguous — does not qualify" });
  }

  // Bot-blocking is not evidence about the site. Never qualify on it.
  if ([401, 403, 429, 503].includes(res.status)) return emit("unknown", { signals: [`http-${res.status}-likely-bot-block`] });
  if (res.status >= 400) {
    // A single 4xx is not proof the SITE is gone: Maps listings carry stale
    // deep links while the root still serves, and flaky hosts can 404
    // intermittently (seen in the field: strict 200/404 alternation, one
    // broken backend in a rotation). Confirm with one retry at the site root
    // before believing "dead". Pin the retry to the LISTED host unless the
    // final host is the same apex — when a redirect landed off-domain, a
    // stranger's homepage must not be scored as this business's site.
    let finalApex = null;
    try {
      finalApex = new URL(res.finalUrl).hostname.replace(/^www\./, "");
    } catch {}
    const r = new URL(finalApex === apex ? res.finalUrl : url);
    r.pathname = "/";
    r.search = "";
    const retry = await tryFetch(r.href);
    if (retry.html) {
      res = retry; // live on retry — analyse that instead
    } else if ([401, 403, 429, 503].includes(retry.status)) {
      return emit("unknown", { signals: [`http-${res.status}`, `retry-http-${retry.status}-likely-bot-block`] });
    } else if (retry.status >= 400) {
      return emit("dead", { signals: [`http-${res.status}`], finalUrl: res.finalUrl, note: `root retry also failed (http-${retry.status})` });
    } else {
      // Retry produced no information (timeout, reset, empty body). That does
      // not CONFIRM the 4xx, and the contract forbids qualifying on ambiguity.
      return emit("unknown", { signals: [`http-${res.status}`, `retry-${retry.err || "empty-response"}`], note: "4xx unconfirmed — does not qualify" });
    }
  }
  if (!res.html) return emit("unknown", { signals: ["empty-response"] });

  // Own domain redirecting to a social/directory/booking host = hollow domain: the
  // business's "website" is effectively gone. Qualifies (the domain itself is the problem).
  if (NOT_OWN_SITE.test(res.finalUrl)) {
    return emit("bad", { signals: ["redirects-off-domain"], finalUrl: res.finalUrl, fetchedMs: res.ms });
  }

  const signals = staticSignals(res);
  const v = verdictFrom(signals);
  return emit(v === "ok-minor" ? "ok" : v, { signals, finalUrl: res.finalUrl, fetchedMs: res.ms });
})();
