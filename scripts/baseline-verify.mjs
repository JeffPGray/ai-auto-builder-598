import { chromium } from '/Users/jeffgray/.npm/_npx/705bc6b22212b352/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const OUT = '/Users/jeffgray/Github/klaudius/baseline';
const BASE = 'https://impactlandscapes-net.grayreserve.agency';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const report = {};

// --- A. is the white-on-cream text a scroll-reveal? scroll it into view and re-measure
for (const p of ['services', 'about']) {
  await page.goto(`${BASE}/${p}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const r = await page.evaluate(async () => {
    const srgb = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); };
    const L = r => .2126 * srgb(r[0]) + .7152 * srgb(r[1]) + .0722 * srgb(r[2]);
    const P = s => (String(s).match(/-?[\d.]+/g) || []).slice(0, 3).map(Number);
    const R = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
    const hex = r => '#' + r.map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
    const out = [];
    const els = [...document.querySelectorAll('p')].filter(e => e.children.length === 0 && e.textContent.trim());
    for (const el of els) {
      const before = getComputedStyle(el).color;
      el.scrollIntoView({ block: 'center' });
      await new Promise(r => setTimeout(r, 1400));
      const cs = getComputedStyle(el);
      const fg = P(cs.color);
      // effective bg
      let n = el, bg = [255, 255, 255];
      while (n) { const b = getComputedStyle(n).backgroundColor; const pp = P(b); const al = String(b).match(/rgba?\([^)]*,\s*([\d.]+)\)/); if (pp.length === 3 && (!al || +al[1] > .5)) { bg = pp; break; } n = n.parentElement; }
      const ratio = Math.round(R(fg, bg) * 100) / 100;
      if (ratio < 4.5) out.push({ text: el.textContent.trim().slice(0, 55), colorAtTop: before, colorInView: cs.color, fg: hex(fg), bg: hex(bg), ratio, opacity: cs.opacity, cls: el.className });
    }
    return out;
  });
  report[`scrollreveal-${p}`] = r;
}

// --- B. mobile menu links: are they actually visible when menu is closed?
const mctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
const mp = await mctx.newPage();
await mp.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await mp.waitForTimeout(2000);
report.mobileMenu = await mp.evaluate(() => {
  const links = [...document.querySelectorAll('a')].filter(a => ['Services', 'About', 'Contact'].includes(a.textContent.trim()) && parseFloat(getComputedStyle(a).fontSize) >= 18);
  return links.map(a => {
    const r = a.getBoundingClientRect();
    let n = a, chain = [];
    while (n && chain.length < 6) { const cs = getComputedStyle(n); chain.push({ tag: n.tagName + '.' + (typeof n.className === 'string' ? n.className.trim() : ''), opacity: cs.opacity, visibility: cs.visibility, transform: cs.transform, pointerEvents: cs.pointerEvents, display: cs.display }); n = n.parentElement; }
    return { text: a.textContent.trim(), rect: { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width) }, inViewport: r.top < 812 && r.bottom > 0 && r.left < 375 && r.right > 0, chain };
  });
});
await mctx.close();

// --- C. hero video: present? loaded? playing?
report.video = {};
for (const [name, path] of [['home', '/'], ['services', '/services'], ['about', '/about'], ['contact', '/contact']]) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  report.video[name] = await page.evaluate(() => [...document.querySelectorAll('video')].map(v => ({
    src: v.currentSrc || v.src || [...v.querySelectorAll('source')].map(s => s.src).join(','),
    poster: v.poster, autoplay: v.autoplay, loop: v.loop, muted: v.muted,
    readyState: v.readyState, networkState: v.networkState,
    videoWidth: v.videoWidth, videoHeight: v.videoHeight,
    currentTime: v.currentTime, paused: v.paused, duration: v.duration,
    rect: (r => ({ w: Math.round(r.width), h: Math.round(r.height) }))(v.getBoundingClientRect()),
  })));
}

// --- D. unique media inventory across all 4 pages (network-level)
const media = new Set();
for (const [, path] of [['home', '/'], ['services', '/services'], ['about', '/about'], ['contact', '/contact']]) {
  const seen = [];
  page.on('response', res => { const u = res.url(); if (/\.(jpg|jpeg|png|webp|avif|mp4|webm|mov)(\?|$)/i.test(u)) seen.push(u); });
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  // also scroll the whole page to trigger lazy loads
  await page.evaluate(async () => { const h = document.body.scrollHeight; for (let y = 0; y < h; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } });
  await page.waitForTimeout(2500);
  seen.forEach(u => media.add(u));
  page.removeAllListeners('response');
}
report.mediaAssets = [...media].sort();

// --- E. first viewport content, home only, both breakpoints
for (const [label, w, h, mob] of [['1440x900', 1440, 900, false], ['375x812', 375, 812, true]]) {
  const c = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob });
  const pg = await c.newPage();
  await pg.goto(BASE + '/', { waitUntil: 'networkidle' });
  await pg.waitForTimeout(2500);
  await pg.evaluate(() => window.scrollTo(0, 0));
  report[`firstViewport-${label}`] = await pg.evaluate(() => {
    const vh = innerHeight, out = [];
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.05) continue;
      const r = el.getBoundingClientRect();
      if (!(r.top < vh && r.bottom > 0 && r.width > 2 && r.height > 2)) continue;
      if (el.tagName === 'IMG' || el.tagName === 'VIDEO') { out.push({ tag: el.tagName, src: (el.currentSrc || el.src || '').slice(-70), top: Math.round(r.top), h: Math.round(r.height) }); continue; }
      if (el.children.length === 0) {
        const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
        if (t) out.push({ tag: el.tagName, cls: (typeof el.className === 'string' ? el.className : '').slice(0, 30), text: t.slice(0, 70), top: Math.round(r.top), fontPx: parseFloat(cs.fontSize) });
      }
    }
    return out;
  });
  await c.close();
}

await browser.close();
fs.writeFileSync(`${OUT}/raw-verify.json`, JSON.stringify(report, null, 2));
console.log('WROTE raw-verify.json');
