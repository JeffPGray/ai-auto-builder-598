#!/usr/bin/env node
/**
 * qa-serve.mjs <site-dir> [--port N]  — the ONE canonical static server for every QA/verify check.
 *
 * WHY THIS EXISTS. next.config.mjs sets a mandatory `assetPrefix` of `/klaudius/<slug>/`, so the
 * document serves at `/` while every CSS/JS/font URL it references is prefixed. A naive
 * `python3 -m http.server --directory out` therefore serves the HTML fine and 404s every asset.
 *
 * 2026-08-21: stream + HTTP Range for hero.mp4. readFileSync of the whole video on every browser
 * Range seek OOMs / kills the process — images looked broken because the server died mid-load.
 *
 * Prints PORT=<n> and writes <site-dir>/.qa-port.
 */
import http from 'node:http';
import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const args = process.argv.slice(2);
const siteDir = args.find((a) => !a.startsWith('--')) || '.';
const outDir = ['out', 'dist', 'build'].map((d) => join(siteDir, d)).find((d) => existsSync(d));
if (!outDir) { console.error(`qa-serve: no built output under ${siteDir}`); process.exit(2); }
const pi = args.indexOf('--port');
const wanted = pi !== -1 ? Number(args[pi + 1]) : 0;

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain', '.xml': 'application/xml',
};

function resolveFile(urlPath) {
  let p = decodeURIComponent((urlPath || '/').split('?')[0]);
  p = p.replace(/^\/klaudius\/[^/]+\//, '/');
  let f = join(outDir, p);
  try {
    if (!existsSync(f) || statSync(f).isDirectory()) {
      for (const c of [`${f}.html`, join(f, 'index.html'), join(outDir, 'index.html')]) {
        if (existsSync(c) && statSync(c).isFile()) { f = c; break; }
      }
    }
  } catch {
    return null;
  }
  if (!existsSync(f) || statSync(f).isDirectory()) return null;
  return f;
}

const server = http.createServer((req, res) => {
  try {
    const f = resolveFile(req.url || '/');
    if (!f) {
      res.writeHead(404);
      return res.end('not found');
    }
    const st = statSync(f);
    const type = MIME[extname(f)] || 'application/octet-stream';
    const range = req.headers.range;
    if (range && /^bytes=/.test(range)) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        return res.end();
      }
      let start = m[1] ? Number(m[1]) : 0;
      let end = m[2] ? Number(m[2]) : st.size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= st.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        return res.end();
      }
      end = Math.min(end, st.size - 1);
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${st.size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=60',
      });
      createReadStream(f, { start, end }).on('error', () => { try { res.destroy(); } catch {} }).pipe(res);
      return;
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': st.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=60',
    });
    createReadStream(f).on('error', () => { try { res.destroy(); } catch {} }).pipe(res);
  } catch (err) {
    console.error('qa-serve error', err?.message || err);
    if (!res.headersSent) res.writeHead(500);
    try { res.end('error'); } catch {}
  }
});

server.on('error', (err) => {
  console.error('qa-serve listen error', err.message);
  process.exit(1);
});

server.listen(wanted || 0, '127.0.0.1', () => {
  const port = server.address().port;
  writeFileSync(join(siteDir, '.qa-port'), String(port));
  console.log(`PORT=${port}`);
});
