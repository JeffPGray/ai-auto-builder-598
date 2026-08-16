#!/usr/bin/env node
/**
 * Facebook Page Scraper — Extract business info from a public Facebook page
 *
 * Usage:
 *   node scripts/fb-page.js https://www.facebook.com/PageName
 *   node scripts/fb-page.js https://www.facebook.com/people/SomeBiz/61571814697052/
 *   node scripts/fb-page.js https://www.facebook.com/profile.php?id=61571814697052
 *
 * Uses Patchright (anti-detection Playwright fork) to bypass Facebook's bot detection.
 * Extracts: name, bio/about, email, phone, address, hours, website, follower count.
 *
 * Navigates to the page's /about tab — that's where the public contact block
 * (email, phone, address) renders, and it renders even logged-out behind the
 * login banner. The base page often doesn't show the email at all, so scraping
 * the URL as-given silently under-reports contact info.
 */

const args = process.argv.slice(2);
const brief = args.includes("--brief"); // skip the raw-text dump — for find-stage email screening
const url = args.find((a) => !a.startsWith("--"));

if (!url || !url.includes("facebook.com")) {
  console.log("Facebook Page Scraper\n");
  console.log("Usage:");
  console.log('  node scripts/fb-page.js https://www.facebook.com/PageName');
  console.log('  node scripts/fb-page.js https://www.facebook.com/people/SomeBiz/123456/');
  console.log('  node scripts/fb-page.js https://www.facebook.com/profile.php?id=123456');
  console.log('  node scripts/fb-page.js --brief <url>    # structured fields only, no raw-text dump');
  process.exit(0);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Build the /about URL for any of the supported page-URL shapes.
function toAboutUrl(pageUrl) {
  const clean = pageUrl.split("#")[0];
  // profile.php?id=123 → profile.php?id=123&sk=about
  if (clean.includes("profile.php")) {
    return clean.includes("sk=about") ? clean : clean + (clean.includes("?") ? "&" : "?") + "sk=about";
  }
  const base = clean.split("?")[0].replace(/\/$/, "");
  if (/\/about$/i.test(base)) return base;
  return base + "/about";
}

// Emails that appear in page text but aren't the business's contact address:
// platform/CDN domains, site-builder support addresses (a Webador/Wix-built
// page renders the builder's own support email), placeholder addresses, and
// asset filenames like logo@2x.png that match a naive email regex.
//
// Bias the list toward false NEGATIVES: letting a rare placeholder through
// costs one bounced send, but filtering a real business email silently costs
// the lead its only contactable channel. So only domains that are PURELY
// platforms belong here (no "sentry"/"duda" — those are also real trading
// names/surnames), and local-part filtering stays minimal ("email@own-domain"
// is a genuine SMB pattern, so it's not filtered).
function cleanEmails(candidates) {
  const seen = {};
  return (candidates || []).filter(function (e) {
    e = e.toLowerCase();
    if (seen[e]) return false;
    seen[e] = true;
    // (?:[\w-]+\.)* makes the match subdomain-tolerant: no-reply@mail.wix.com
    // is just as much junk as support@wix.com.
    if (/@(?:[\w-]+\.)*(facebook|fb|fbcdn|instagram|cdninstagram|meta)\./.test(e)) return false;
    if (/@(?:[\w-]+\.)*(example|wix|wixpress|wixsite|godaddy|squarespace|webador|jimdo|weebly)\./.test(e)) return false;
    if (/\.(png|jpe?g|gif|webp|svg|ico)$/.test(e)) return false;
    if (/^(ejemplo|example|test|sample|user|name|youremail|tuemail|deinemail)@/.test(e)) return false;
    return true;
  });
}

async function scrape(pageUrl) {
  const { chromium } = require("patchright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Try the /about tab first (contact block lives there); fall back to the
  // URL as-given if the about tab is missing or blocked.
  const urlsToTry = [toAboutUrl(pageUrl)];
  if (urlsToTry[0] !== pageUrl) urlsToTry.push(pageUrl);

  let bodyText = "";
  let loadedUrl = "";
  try {
    for (const candidate of urlsToTry) {
      console.error(`Loading ${candidate}...`);
      try {
        await page.goto(candidate, { waitUntil: "domcontentloaded", timeout: 30000 });
        await sleep(4000);

        // Close login popup if present
        try {
          const closeBtn = await page.$('[aria-label="Close"]');
          if (closeBtn) {
            await closeBtn.click();
            await sleep(1000);
          }
        } catch (_) {}

        bodyText = await page.evaluate(() => document.body.innerText);
      } catch (err) {
        // Covers goto failures AND evaluate() throwing after a client-side
        // redirect ("Execution context was destroyed") — either way this
        // candidate is a dud; fall through to the next URL shape.
        console.error(`  Failed on this URL (${err.message.split("\n")[0]}), trying next...`);
        continue;
      }

      // Viability gate — must be language-independent, because it now routes
      // the /about → base-URL fallback (the English sentinels alone would
      // scrape a login redirect or a localized error page as if it were the
      // business page). Real pages run 2000+ chars of body text logged-out;
      // error/interstitial pages are near-empty.
      const finalUrl = page.url();
      const isLoginWall = /\/login|\/checkpoint\/|[?&]next=/.test(finalUrl);
      const isErrorPage =
        bodyText.includes("This content isn't available") ||
        bodyText.includes("This page isn't available") ||
        bodyText.length < 500;
      if (!isLoginWall && !isErrorPage) {
        loadedUrl = candidate;
        break;
      }
      console.error(`  Not usable at this URL (${isLoginWall ? "login redirect" : "unavailable or near-empty"}), trying next...`);
    }

    if (!loadedUrl) {
      console.log("ERROR: Page not available (may require login or doesn't exist)");
      await browser.close();
      process.exit(1);
    }

    // Extract structured data from the page
    const data = await page.evaluate(() => {
      var text = document.body.innerText;
      var result = {};

      // Page name from h1 or og:title
      var ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) result.name = ogTitle.getAttribute("content") || "";
      if (!result.name) {
        var h1 = document.querySelector("h1");
        if (h1) result.name = h1.innerText.trim();
      }

      // Description from og:description
      var ogDesc = document.querySelector('meta[property="og:description"]');
      if (ogDesc) result.description = ogDesc.getAttribute("content") || "";

      // Emails — collect ALL matches from the page text; junk-filtered
      // (platform/builder/placeholder addresses) after extraction.
      var emailMatches = text.match(/[\w.+-]+@[\w.-]+\.\w{2,}/g);
      if (emailMatches) result.email_candidates = emailMatches;

      // Phone numbers — region-agnostic match. See instagram-profile.js for
      // full design notes. Matches E.164 international (preferred, always
      // starts with +) and national-with-separators across any country.
      var phoneMatches = text.match(/(?:\+\d{1,3}[\s.()-]?(?:\d[\s.()-]?){6,14}\d|\b(?:\d{2,4}[\s.()-]+){2,}\d{2,4}\b)/g);
      if (phoneMatches) result.phones = phoneMatches.map(function(p) { return p.replace(/\s+/g, " ").trim(); });

      // Follower/like counts
      var followMatch = text.match(/([\d,.]+[KMB]?)\s*(?:people follow|followers)/i);
      if (followMatch) result.followers = followMatch[1];
      var likeMatch = text.match(/([\d,.]+[KMB]?)\s*(?:people like|likes)/i);
      if (likeMatch) result.likes = likeMatch[1];

      // Rating
      var ratingMatch = text.match(/([\d.]+)\s*(?:out of 5|★|stars?)/i);
      if (ratingMatch) result.rating = ratingMatch[1];

      // Category (often appears near the top)
      var categoryEl = document.querySelector('[data-pagelet="ProfileTilesFeed_0"] a, [role="tablist"] + div');
      if (categoryEl) {
        var catText = categoryEl.innerText.trim();
        if (catText.length < 60) result.category = catText;
      }

      return result;
    });

    // The /about tab carries the contact block but sometimes omits the intro
    // card's social-proof numbers. If they're missing and we scraped an
    // /about-shaped URL, take one best-effort pass at the base page for the
    // social fields only — the /about data (email, phones) stands regardless.
    if (loadedUrl !== pageUrl && !data.followers && !data.likes) {
      try {
        await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
        await sleep(3000);
        const extra = await page.evaluate(() => {
          var text = document.body.innerText;
          var r = {};
          var followMatch = text.match(/([\d,.]+[KMB]?)\s*(?:people follow|followers)/i);
          if (followMatch) r.followers = followMatch[1];
          var likeMatch = text.match(/([\d,.]+[KMB]?)\s*(?:people like|likes)/i);
          if (likeMatch) r.likes = likeMatch[1];
          var ratingMatch = text.match(/([\d.]+)\s*(?:out of 5|★|stars?)/i);
          if (ratingMatch) r.rating = ratingMatch[1];
          var ogDesc = document.querySelector('meta[property="og:description"]');
          if (ogDesc) r.description = ogDesc.getAttribute("content") || "";
          return r;
        });
        if (extra.followers) data.followers = extra.followers;
        if (extra.likes) data.likes = extra.likes;
        if (extra.rating && !data.rating) data.rating = extra.rating;
        if (extra.description && !data.description) data.description = extra.description;
      } catch (_) {}
    }

    await browser.close();

    // Junk-filter the raw email candidates; keep the first clean one as THE
    // email but expose the rest in the JSON for manual judgement.
    const emails = cleanEmails(data.email_candidates);
    data.email = emails[0] || "";
    data.emails = emails;
    delete data.email_candidates;

    // Print results
    console.log(`\nPage: ${data.name || "Unknown"}`);
    console.log(`Description: ${data.description || "none"}`);
    console.log(`Email: ${data.email || "none"}`);
    if (emails.length > 1) console.log(`Other emails on page: ${emails.slice(1).join(", ")}`);
    if (data.phones && data.phones.length > 0) {
      console.log(`Phone: ${data.phones.join(", ")}`);
    } else {
      console.log("Phone: none");
    }
    console.log(`Followers: ${data.followers || "unknown"}`);
    console.log(`Likes: ${data.likes || "unknown"}`);
    console.log(`Rating: ${data.rating || "unknown"}`);
    console.log(`Category: ${data.category || "unknown"}`);

    // Also dump the first 3000 chars of raw text for manual inspection
    // (suppressed with --brief, where only the structured fields matter)
    if (!brief) {
      console.log(`\n--- RAW TEXT (first 3000 chars) ---\n`);
      console.log(bodyText.substring(0, 3000));
    }

    console.log("\n---JSON---");
    console.log(JSON.stringify(data, null, 2));

  } catch (e) {
    // Guard the close: if the browser itself is wedged, we still want the
    // real error on stderr rather than an unhandled rejection.
    try { await browser.close(); } catch (_) {}
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
}

scrape(url);
