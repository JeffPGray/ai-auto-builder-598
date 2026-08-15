import { chromium } from '/Users/jeffgray/.npm/_npx/705bc6b22212b352/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const OUT = '/Users/jeffgray/Github/klaudius/baseline';
const BASE = 'https://impactlandscapes-net.grayreserve.agency';
const PAGES = [['home', '/'], ['services', '/services'], ['about', '/about'], ['contact', '/contact']];
const VIEWS = [['1440x900', 1440, 900], ['375x812', 375, 812]];

// --- measurement fn injected into the page ---
function measure() {
  const srgb = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = (rgb) => 0.2126 * srgb(rgb[0]) + 0.7152 * srgb(rgb[1]) + 0.0722 * srgb(rgb[2]);
  const parse = (s) => { const m = String(s).match(/-?[\d.]+/g); return m ? m.slice(0, 3).map(Number) : null; };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); };
  const hex = (rgb) => '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  // effective background: walk ancestors until non-transparent
  const effBg = (el) => {
    let n = el;
    while (n && n !== document.documentElement.parentNode) {
      const bg = getComputedStyle(n).backgroundColor;
      const p = parse(bg);
      const alpha = String(bg).match(/rgba?\([^)]*,\s*([\d.]+)\)/);
      if (p && (!alpha || parseFloat(alpha[1]) > 0.5)) return { rgb: p, from: n.tagName + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).join('.') : '') };
      n = n.parentElement;
    }
    return { rgb: [255, 255, 255], from: 'default-white' };
  };

  const out = {};
  out.url = location.href;
  out.scrollHeight = document.documentElement.scrollHeight;
  out.viewport = { w: innerWidth, h: innerHeight };

  // --- DEFECT 1: nav ---
  const navEl = document.querySelector('nav, header nav, .gr-nav, header');
  const navs = [...document.querySelectorAll('nav')].map(n => {
    const cs = getComputedStyle(n);
    const r = n.getBoundingClientRect();
    return {
      sel: n.tagName.toLowerCase() + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).join('.') : ''),
      position: cs.position, zIndex: cs.zIndex, top: cs.top, display: cs.display,
      rectTop: Math.round(r.top), rectHeight: Math.round(r.height),
      pageY: Math.round(r.top + scrollY),
    };
  });
  out.navs = navs;

  // --- DEFECT 2: h1 + first-viewport content ---
  const h1 = document.querySelector('h1');
  out.h1 = h1 ? {
    text: h1.textContent.trim().slice(0, 120),
    pageY: Math.round(h1.getBoundingClientRect().top + scrollY),
    rectTop: Math.round(h1.getBoundingClientRect().top),
  } : null;

  // what business info is inside the first viewport (at scrollY 0)
  const vh = innerHeight;
  const inFirstViewport = [];
  const candidates = [...document.querySelectorAll('h1,h2,h3,a,img,svg,p,span,button')];
  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    if (r.top < vh && r.bottom > 0 && r.width > 0 && r.height > 0) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
      const txt = (el.textContent || '').trim().replace(/\s+/g, ' ');
      if (el.tagName === 'IMG' || el.tagName === 'SVG') {
        inFirstViewport.push({ tag: el.tagName, src: (el.getAttribute('src') || '').slice(-60), alt: el.getAttribute('alt') || '', top: Math.round(r.top) });
      } else if (txt && txt.length < 90 && el.children.length === 0) {
        inFirstViewport.push({ tag: el.tagName, text: txt.slice(0, 80), top: Math.round(r.top) });
      }
    }
  }
  out.firstViewportItems = inFirstViewport.slice(0, 40);
  // phone number anywhere in first viewport?
  out.firstViewportText = document.body.innerText.split('\n').filter(Boolean).slice(0, 15);

  // --- DEFECT 3: lists / details / word count ---
  out.liCount = document.querySelectorAll('li').length;
  out.liTexts = [...document.querySelectorAll('li')].map(l => l.textContent.trim().replace(/\s+/g, ' ').slice(0, 60)).slice(0, 30);
  out.details = [...document.querySelectorAll('details')].map(d => ({
    open: d.hasAttribute('open'),
    summary: (d.querySelector('summary')?.textContent || '').trim().replace(/\s+/g, ' '),
    bodyChars: (d.textContent || '').trim().length,
  }));
  const bodyText = (document.body.innerText || '').replace(/\s+/g, ' ').trim();
  out.wordCount = bodyText ? bodyText.split(' ').length : 0;
  out.charCount = bodyText.length;
  out.headings = [...document.querySelectorAll('h1,h2,h3')].map(h => h.tagName + ': ' + h.textContent.trim().replace(/\s+/g, ' ').slice(0, 70));

  // --- media inventory ---
  const imgs = [...document.querySelectorAll('img')].map(i => ({ src: i.currentSrc || i.src, alt: i.alt || '' }));
  const bgImgs = [];
  for (const el of document.querySelectorAll('*')) {
    const b = getComputedStyle(el).backgroundImage;
    if (b && b !== 'none' && b.includes('url(')) {
      const m = b.match(/url\(["']?([^"')]+)/);
      if (m) bgImgs.push(m[1]);
    }
  }
  out.images = imgs;
  out.bgImages = [...new Set(bgImgs)];
  out.videos = [...document.querySelectorAll('video')].map(v => ({
    src: v.currentSrc || v.src || [...v.querySelectorAll('source')].map(s => s.src).join(','),
    autoplay: v.autoplay, poster: v.poster, w: v.videoWidth, h: v.videoHeight,
    readyState: v.readyState,
  }));
  out.iframes = [...document.querySelectorAll('iframe')].map(f => f.src).slice(0, 10);

  // --- DEFECT 4: contrast ---
  const contrastTargets = [];
  const seen = new Set();
  const sels = ['.gr-nav-cta', '.tag', '[class*="awc__"]', 'a.btn', '.btn', 'button', '.chip', '.pill', '.badge'];
  for (const s of sels) {
    for (const el of document.querySelectorAll(s)) {
      const cs = getComputedStyle(el);
      const fg = parse(cs.color);
      if (!fg) continue;
      const bg = effBg(el);
      const key = s + '|' + cs.color + '|' + hex(bg.rgb);
      if (seen.has(key)) continue;
      seen.add(key);
      const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      contrastTargets.push({
        selector: s,
        cls: typeof el.className === 'string' ? el.className.trim().slice(0, 60) : '',
        text: txt,
        fg: hex(fg), bg: hex(bg.rgb), bgFrom: bg.from.slice(0, 50),
        fontSizePx: parseFloat(cs.fontSize), fontWeight: cs.fontWeight,
        ratio: Math.round(ratio(fg, bg.rgb) * 100) / 100,
      });
    }
  }
  out.contrast = contrastTargets;

  // full sweep: every visible text node element, worst offenders
  const worst = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length > 0) continue;
    const txt = (el.textContent || '').trim();
    if (!txt) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const fg = parse(cs.color); if (!fg) continue;
    const bg = effBg(el);
    const ra = ratio(fg, bg.rgb);
    const fs = parseFloat(cs.fontSize);
    const large = fs >= 24 || (fs >= 18.66 && parseInt(cs.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    if (ra < need) {
      worst.push({ tag: el.tagName, cls: (typeof el.className === 'string' ? el.className : '').trim().slice(0, 50), text: txt.replace(/\s+/g, ' ').slice(0, 40), fg: hex(fg), bg: hex(bg.rgb), fontSizePx: fs, ratio: Math.round(ra * 100) / 100, need });
    }
  }
  out.contrastFailures = worst;
  out.contrastFailureCount = worst.length;

  return out;
}

const results = {};
const browser = await chromium.launch();

for (const [label, w, h] of VIEWS) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
    isMobile: w < 768,
    hasTouch: w < 768,
    userAgent: w < 768 ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' : undefined,
  });
  const page = await ctx.newPage();
  for (const [name, path] of PAGES) {
    const url = BASE + path;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(e => console.error('nav err', url, e.message));
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    await page.screenshot({ path: `${OUT}/${name}-${label}-viewport.png` });
    await page.screenshot({ path: `${OUT}/${name}-${label}-full.png`, fullPage: true });

    const m = await page.evaluate(measure);

    // nav position after scrolling 3000px (defect 1)
    const scrolled = await page.evaluate(() => {
      window.scrollTo(0, 3000);
      return new Promise(res => setTimeout(() => {
        const navs = [...document.querySelectorAll('nav')].map(n => {
          const r = n.getBoundingClientRect();
          const cs = getComputedStyle(n);
          return { sel: n.tagName.toLowerCase() + '.' + (typeof n.className === 'string' ? n.className.trim().split(/\s+/).join('.') : ''), rectTop: Math.round(r.top), position: cs.position, visibleInViewport: r.bottom > 0 && r.top < innerHeight };
        });
        res({ scrollY: window.scrollY, navs });
      }, 600));
    });
    m.navAtScroll3000 = scrolled;
    await page.evaluate(() => window.scrollTo(0, 0));

    results[`${name}@${label}`] = m;
    console.error('done', name, label);
  }
  await ctx.close();
}
await browser.close();
fs.writeFileSync(`${OUT}/raw-measurements.json`, JSON.stringify(results, null, 2));
console.log('WROTE', `${OUT}/raw-measurements.json`);
