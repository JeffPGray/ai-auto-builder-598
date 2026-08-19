#!/usr/bin/env node
/**
 * qa-serve.mjs <site-dir> [--port N]  — the ONE canonical static server for every QA/verify check.
 *
 * WHY THIS EXISTS. next.config.mjs sets a mandatory `assetPrefix` of `/klaudius/<slug>/`, so the
 * document serves at `/` while every CSS/JS/font URL it references is prefixed. A naive
 * `python3 -m http.server --directory out` therefore serves the HTML fine and 404s every asset.
 * The page renders unstyled and NEVER HYDRATES.
 *
 * That silently broke browser-based checks: on 2026-08-19 verify-hero-video.mjs reported
 * HERO_VIDEO_PLAYBACK_CHECK=FAIL ("no playback") on a build whose <video> was present and correct.
 * Measured cause: JS chunks 404 -> React never hydrates -> HeroVideo's start() never runs ->
 * preload stays "none" -> readyState 0, paused true, videoWidth 0. The video was fine; the SERVER
 * was wrong. contrast-check.mjs had the identical bug and was fixed separately in its own inline
 * server; this file exists so the fix lives in exactly one place instead of being re-fixed per script.
 *
 * Prints the chosen port on stdout as `PORT=<n>` and writes it to <site-dir>/.qa-port.
 */
import http from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const args = process.argv.slice(2);
const siteDir = args.find((a) => !a.startsWith('--')) || '.';
const outDir = ['out', 'dist', 'build'].map((d) => join(siteDir, d)).find((d) => existsSync(d));
if (!outDir) { console.error(`qa-serve: no built output under ${siteDir}`); process.exit(2); }
const pi = args.indexOf('--port');
const wanted = pi !== -1 ? Number(args[pi + 1]) : 0;

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain', '.xml': 'application/xml' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  // THE FIX: strip the assetPrefix so /klaudius/<slug>/_next/... resolves inside out/
  p = p.replace(/^\/klaudius\/[^/]+\//, '/');
  let f = join(outDir, p);
  try {
    if (!existsSync(f) || statSync(f).isDirectory()) {
      for (const c of [`${f}.html`, join(f, 'index.html'), join(outDir, 'index.html')]) {
        if (existsSync(c) && statSync(c).isFile()) { f = c; break; }
      }
    }
  } catch { /* fall through to 404 */ }
  if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});

server.listen(wanted, () => {
  const port = server.address().port;
  writeFileSync(join(siteDir, '.qa-port'), String(port));
  console.log(`PORT=${port}`);
});
