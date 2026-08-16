import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * assetPrefix — DO NOT REMOVE. Without it the deployed site renders but NEVER HYDRATES.
 *
 * The shared previews lane serves a tenant's DOCUMENT at the subdomain root
 * (https://<slug>.grayreserve.agency/) while its ASSETS live under /klaudius/<slug>/. Next bakes the
 * asset base into the client runtime AT BUILD TIME, so a build with no assetPrefix ships a runtime
 * that looks for its chunks at the domain root, never resolves its client components, and silently
 * does nothing.
 *
 * "Silently" is the dangerous part, and it is why this is computed rather than left to a checklist:
 * the page renders perfectly from static HTML, every chunk returns 200, and the console is EMPTY —
 * a module that is never requested cannot fail loudly. What you actually get is a dead mobile menu,
 * a chat bubble that will not open, no GSAP or Lenis, and every [data-reveal] frozen at opacity 1.
 * It looks like a design problem, not a bug.
 *
 * Proven by controlled comparison on 2026-08-16: demolition-okc had `assetPrefix:
 * '/klaudius/demolition-okc'` and hydrated; abacus-plumbing had none and did not. Their served HTML
 * was otherwise BYTE-IDENTICAL once the path prefixes were normalised, and abacus's own build
 * hydrated fine when served from out/ with assets at the root — so the asset base was the only
 * variable. (An earlier note in this project claimed assetPrefix was not the fix; that note was
 * wrong, almost certainly tested without rebuilding, and has been corrected.)
 *
 * It is DERIVED from the directory name, not hand-written, because every site is built at
 * clients/<slug>/site/ and a value someone has to remember to set is a value that eventually is not
 * set — which is exactly what happened here. If this file is ever moved out of clients/<slug>/site/,
 * fix this derivation rather than deleting it.
 */
const siteDir = dirname(fileURLToPath(import.meta.url)); // .../clients/<slug>/site
const slug = basename(dirname(siteDir));                 // <slug>

/* Escape hatch for a tenant served from its own project root (no /klaudius/<slug>/ prefix):
 * KLAUDIUS_ASSET_PREFIX='' disables it explicitly. Unset still means "derive", so the safe path is
 * the default and opting out has to be deliberate. */
const assetPrefix =
  process.env.KLAUDIUS_ASSET_PREFIX !== undefined
    ? process.env.KLAUDIUS_ASSET_PREFIX
    : `/klaudius/${slug}`;

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  ...(assetPrefix ? { assetPrefix } : {}),
  images: { unoptimized: true },
};

export default nextConfig;
