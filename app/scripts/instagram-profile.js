#!/usr/bin/env node
/**
 * Instagram Profile & Photo Fetcher
 *
 * Usage:
 *   node scripts/instagram-profile.js HANDLE                    # Profile metadata
 *   node scripts/instagram-profile.js photos HANDLE OUTPUT_DIR  # Download 4-6 photos
 *
 * Tries the REST API first (fast), falls back to Patchright page scraping if rate limited.
 *
 * KNOWN LIMITATION (verified 2026-07-28): the REST API now returns a server-side
 * schema error ("Asset .../ig_business_category_subvertical has been deleted")
 * for most SMB business/professional accounts — exactly the accounts this
 * pipeline targets. Big brand accounts still work, small business ones don't,
 * and retries don't help. When that happens the Patchright fallback still gets
 * bio/followers/photos, but it CANNOT see the account's business contact email
 * (logged-out Instagram never renders it in the page). So for schema-failed
 * accounts, "no email" means UNKNOWABLE, not "the business has no email" —
 * the output says so explicitly. Don't treat it as a definitive negative.
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

function getArgs() {
  const args = process.argv.slice(2);
  if (args[0] === "photos") {
    return { command: "photos", handle: (args[1] || "").replace(/^@/, ""), outputDir: args[2] };
  }
  return { command: "profile", handle: (args[0] || "").replace(/^@/, "") };
}

const { command, handle, outputDir } = getArgs();

if (!handle) {
  console.log("Instagram Profile & Photo Fetcher\n");
  console.log("Commands:");
  console.log("  node scripts/instagram-profile.js HANDLE                    Profile metadata");
  console.log("  node scripts/instagram-profile.js photos HANDLE OUTPUT_DIR  Download 4-6 photos");
  process.exit(0);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── REST API (fast, structured JSON) ──
async function tryApi() {
  try {
    const result = execSync(
      `curl -s "https://i.instagram.com/api/v1/users/web_profile_info/?username=${handle}" -H "x-ig-app-id: 936619743392459" -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"`,
      { timeout: 10000 }
    ).toString();

    const data = JSON.parse(result);
    if (data.status === "fail") {
      // Distinguish the permanent per-account schema breakage (see header
      // comment) from transient rate-limiting — the caller reports the email
      // as "unavailable" rather than "none" in the schema-fail case.
      const schemaDead = /has been deleted|laser\.provider/i.test(data.message || "");
      return { failed: true, schemaDead, message: data.message || "" };
    }
    if (!data.data || !data.data.user) return null;

    const user = data.data.user;
    return {
      source: "api",
      username: user.username,
      full_name: user.full_name,
      bio: user.biography,
      followers: user.edge_followed_by?.count,
      following: user.edge_follow?.count,
      posts: user.edge_owner_to_timeline_media?.count,
      is_business: user.is_business_account,
      category: user.category_name || "",
      business_email: user.business_email || "",
      business_phone: user.business_phone_number || "",
      website: user.external_url || "",
      is_private: user.is_private,
      profile_pic: user.profile_pic_url_hd || user.profile_pic_url || "",
    };
  } catch (_) {
    return null;
  }
}

// ── Patchright page scraping (fallback) ──
async function tryPatchright() {
  try {
    const { chromium } = require("patchright");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(`https://www.instagram.com/${handle}/`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await sleep(3000);

    const title = await page.title();
    if (title.includes("isn't available") || title.includes("Page Not Found")) {
      await browser.close();
      return { source: "patchright", error: "Profile not found" };
    }

    const data = await page.evaluate(() => {
      const result = {};

      const ogDesc = document.querySelector('meta[property="og:description"]');
      if (ogDesc) {
        const content = ogDesc.getAttribute("content") || "";
        const countsMatch = content.match(
          /([\d,.]+[KMB]?)\s*Followers?,\s*([\d,.]+[KMB]?)\s*Following,\s*([\d,.]+[KMB]?)\s*Posts?/i
        );
        if (countsMatch) {
          result.followers_text = countsMatch[1];
          result.following_text = countsMatch[2];
          result.posts_text = countsMatch[3];
        }
        const nameMatch = content.match(/from\s+(.+?)\s*\(@/);
        if (nameMatch) result.full_name = nameMatch[1];
      }

      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) {
        const m = (ogTitle.getAttribute("content") || "").match(/^(.+?)\s*\(@/);
        if (m && !result.full_name) result.full_name = m[1];
      }

      const bioSection = document.querySelector('meta[name="description"]');
      if (bioSection) result.meta_description = bioSection.getAttribute("content") || "";

      const bodyText = document.body.innerText;
      const emailMatch = bodyText.match(/[\w.-]+@[\w.-]+\.\w{2,}/);
      if (emailMatch) result.email_from_page = emailMatch[0];
      // Match phone numbers in any country's format. Two alternatives:
      //   1. E.164 international (preferred): + then a 1-3 digit country code,
      //      then 6-14 more digits with optional separators (space, dot, paren,
      //      dash). Matches "+44 7123 456789", "+12025550123", "+49 30 12345678".
      //   2. National with separators: 2+ digit-chunks broken by separators.
      //      Matches "0207 946 0958", "(555) 123-4567", "333 123 4567" (Italian
      //      mobile, no leading zero), etc.
      // Some 8-digit date strings can match the national pattern; downstream
      // E.164 normalisation rejects non-phone strings before they're dialled,
      // so this isn't load-bearing.
      const phoneMatch = bodyText.match(/(?:\+\d{1,3}[\s.()-]?(?:\d[\s.()-]?){6,14}\d|\b(?:\d{2,4}[\s.()-]+){2,}\d{2,4}\b)/);
      if (phoneMatch) result.phone_from_page = phoneMatch[0];

      const websiteLink = document.querySelector('a[href*="l.instagram.com/"]');
      if (websiteLink) result.website = websiteLink.getAttribute("href") || "";

      result.is_private = bodyText.includes("This account is private");
      return result;
    });

    await browser.close();

    function parseCount(text) {
      if (!text) return 0;
      text = text.replace(/,/g, "");
      if (text.endsWith("K")) return Math.round(parseFloat(text) * 1000);
      if (text.endsWith("M")) return Math.round(parseFloat(text) * 1000000);
      if (text.endsWith("B")) return Math.round(parseFloat(text) * 1000000000);
      return parseInt(text) || 0;
    }

    return {
      source: "patchright",
      username: handle,
      full_name: data.full_name || "",
      bio: data.meta_description || "",
      followers: parseCount(data.followers_text),
      following: parseCount(data.following_text),
      posts: parseCount(data.posts_text),
      category: "",
      business_email: data.email_from_page || "",
      business_phone: data.phone_from_page || "",
      website: data.website || "",
      is_private: data.is_private || false,
    };
  } catch (e) {
    return { source: "patchright", error: e.message };
  }
}

// ── PHOTOS: Extract and download photos from posts ──
async function downloadPhotos() {
  if (!outputDir) {
    console.error("Usage: node scripts/instagram-profile.js photos HANDLE OUTPUT_DIR");
    process.exit(1);
  }

  const { chromium } = require("patchright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.error(`Fetching photos from @${handle}...`);

  // Visit profile — wait for page to fully render
  await page.goto(`https://www.instagram.com/${handle}/`, {
    waitUntil: "load",
    timeout: 20000,
  });
  await sleep(5000);
  // Scroll down slightly to trigger lazy-loading of the post grid
  await page.evaluate(() => { window.scrollTo(0, 400); });
  await sleep(3000);

  const title = await page.title();
  if (title.includes("isn't available") || title.includes("Page Not Found")) {
    console.log("ERROR: Profile not found");
    await browser.close();
    process.exit(1);
  }

  if (await page.evaluate(() => document.body.innerText.includes("This account is private"))) {
    console.log("ERROR: Account is private");
    await browser.close();
    process.exit(1);
  }

  // Extract photo post links from the profile grid (only /p/ posts, not /reel/ videos)
  const postLinks = await page.evaluate(() => {
    var links = document.querySelectorAll('a[href]');
    var urls = [];
    var seen = {};
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute("href");
      if (!href) continue;
      if (href.includes("/p/") && !seen[href]) {
        seen[href] = true;
        urls.push("https://www.instagram.com" + href);
      }
      if (urls.length >= 8) break;
    }
    return urls;
  });

  if (postLinks.length === 0) {
    console.log("No photo posts found. Instagram may be blocking the page render, or the account only has Reels (videos).");
    console.log("Fallback: Use playwright-cli to manually visit the profile and extract post URLs.");
    await browser.close();
    process.exit(1);
  }

  console.error(`Found ${postLinks.length} posts. Extracting images...`);

  // Create output dir
  fs.mkdirSync(outputDir, { recursive: true });

  const downloaded = [];
  let photoNum = 1;

  for (const postUrl of postLinks) {
    if (downloaded.length >= 6) break;

    try {
      await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
      await sleep(2000);

      // Extract the main image src from the post
      const imgSrc = await page.evaluate(() => {
        // Try the main post image (article > div img, or role="presentation" images)
        var imgs = document.querySelectorAll('article img[src*="cdninstagram"], img[src*="scontent"]');
        for (var i = 0; i < imgs.length; i++) {
          var src = imgs[i].getAttribute("src");
          var alt = imgs[i].getAttribute("alt") || "";
          var w = imgs[i].naturalWidth || parseInt(imgs[i].getAttribute("width")) || 0;
          // Skip tiny images (profile pics, icons)
          if (src && w > 200) return src;
          if (src && !alt.includes("profile picture") && src.includes("scontent")) return src;
        }
        // Fallback: first large img
        var allImgs = document.querySelectorAll("img");
        for (var j = 0; j < allImgs.length; j++) {
          var s = allImgs[j].getAttribute("src") || "";
          if (s.includes("cdninstagram") || s.includes("scontent")) {
            var width = allImgs[j].naturalWidth || 0;
            if (width > 200 || s.includes("1080x1080") || s.includes("640x640")) return s;
          }
        }
        return null;
      });

      if (!imgSrc) {
        console.error(`  Post ${photoNum}: No image found, skipping`);
        continue;
      }

      // Download the image (CDN URLs expire, so must download immediately)
      const filename = `instagram${photoNum}.jpg`;
      const filepath = path.join(outputDir, filename);

      try {
        execSync(`curl -L -s -o "${filepath}" "${imgSrc}"`, { timeout: 15000 });

        // Verify file was downloaded and has content
        const stats = fs.statSync(filepath);
        if (stats.size < 5000) {
          console.error(`  Post ${photoNum}: Downloaded file too small (${stats.size} bytes), skipping`);
          fs.unlinkSync(filepath);
          continue;
        }

        downloaded.push({ file: filename, path: filepath, source: postUrl });
        console.error(`  Downloaded: ${filename} (${Math.round(stats.size / 1024)}KB)`);
        photoNum++;
      } catch (dlErr) {
        console.error(`  Post ${photoNum}: Download failed: ${dlErr.message}`);
      }
    } catch (e) {
      console.error(`  Post: Error loading ${postUrl}: ${e.message}`);
    }
  }

  await browser.close();

  // Output results
  console.log(`\nDownloaded ${downloaded.length} photos to ${outputDir}:\n`);
  for (const d of downloaded) {
    console.log(`  /images/${d.file} (from ${d.source})`);
  }

  console.log(
    "\nIMPORTANT: Visually verify each photo with the Read tool. Delete any that are text posts, memes, announcements, or not real photos of the business."
  );

  console.log("\n---JSON---");
  console.log(JSON.stringify(downloaded, null, 2));
}

// ── PROFILE: Get metadata ──
async function profile() {
  console.error(`Checking @${handle}...`);
  const apiResult = await tryApi();
  let result = apiResult && !apiResult.failed ? apiResult : null;
  const apiSchemaDead = !!(apiResult && apiResult.failed && apiResult.schemaDead);

  if (result) {
    console.error("Source: Instagram REST API");
  } else {
    if (apiSchemaDead) {
      console.error("REST API schema-dead for this account — falling back to Patchright (business email not retrievable logged-out).");
    } else {
      console.error("API rate limited or failed, falling back to Patchright...");
    }
    result = await tryPatchright();
  }

  if (result.error) {
    console.log(`ERROR: ${result.error}`);
    process.exit(1);
  }

  // Patchright cannot see an account's business contact email logged-out, so
  // whenever the result came from the fallback and carries no email, the
  // email is UNKNOWABLE — regardless of why the API failed (schema-dead
  // account, rate limit, network error). Only an API-sourced result can
  // assert a true "none". And if the fallback DID find an email (in the bio
  // text), it's available by definition — the flag must not contradict it.
  const emailUnavailable = result.source === "patchright" && !result.business_email;

  const emailLine = result.business_email
    ? result.business_email
    : emailUnavailable
      ? "unavailable (Instagram doesn't expose business emails logged-out — NOT proof the business has no email)"
      : "none";

  console.log(`\nProfile: @${result.username}`);
  console.log(`Name: ${result.full_name}`);
  console.log(`Bio: ${result.bio}`);
  console.log(`Followers: ${result.followers}`);
  console.log(`Posts: ${result.posts}`);
  console.log(`Business: ${result.is_business || "unknown"}`);
  console.log(`Category: ${result.category}`);
  console.log(`Email: ${emailLine}`);
  console.log(`Phone: ${result.business_phone || "none"}`);
  console.log(`Website: ${result.website || "none"}`);
  console.log(`Private: ${result.is_private}`);

  console.log("\n---JSON---");
  console.log(JSON.stringify({ ...result, email_unavailable: emailUnavailable }, null, 2));
}

// ── CLI ──
if (command === "photos") {
  downloadPhotos();
} else {
  profile();
}
