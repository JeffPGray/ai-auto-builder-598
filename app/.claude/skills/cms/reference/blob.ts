/**
 * Read/write the editable site content + uploaded photos in Vercel Blob.
 *
 * Installed by the Klaudius cms skill. Everything above the SITE-SPECIFIC
 * marker is generic plumbing — do not edit per site. The mergeWithDefaults
 * function at the bottom is generated per site from this site's content model.
 */

import { put, del, list } from "@vercel/blob";
import {
  defaultContent,
  type SiteContent,
  type Photo,
  type GalleryPhoto,
} from "./content";

// NOTE: the store is PUBLIC, so the content blobs are world-readable at
// guessable URLs. Only public-site content belongs in SiteContent — never
// private notes, unlisted contact details, or anything the owner wouldn't publish.
//
// Each save writes a NEW, uniquely-named blob (content/site-<id>.json) and
// getContent() reads the newest — we do NOT overwrite one stable file. See
// setContent() for the (verified) reason why overwriting is broken.
const CONTENT_PREFIX = "content/site";

/**
 * Fetch the live site content from Vercel Blob — the newest saved version.
 * Falls back to defaultContent on first run (before any edits) or on transient
 * errors — including when BLOB_READ_WRITE_TOKEN isn't set yet, so the site and
 * `next build` keep working before the Blob store is connected.
 */
export async function getContent(): Promise<SiteContent> {
  try {
    const { blobs } = await list({ prefix: CONTENT_PREFIX });
    if (blobs.length === 0) return defaultContent;
    const newest = blobs.sort(
      (a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt)
    )[0];
    const res = await fetch(newest.url, { cache: "no-store" });
    if (!res.ok) return defaultContent;
    const data = (await res.json()) as Partial<SiteContent>;
    return mergeWithDefaults(data);
  } catch {
    return defaultContent;
  }
}

/**
 * Persist the full site content to Vercel Blob under a NEW unique pathname, then
 * prune older versions. getContent() reads the newest.
 *
 * Why not overwrite one stable file? Verified empirically: overwriting a stable
 * Blob URL does NOT invalidate the Vercel Blob CDN — an immediate read after the
 * overwrite returns the OLD content. A `?query` cache-buster does not help (the
 * Blob CDN ignores the query string), and `cacheControlMaxAge` only shortens the
 * stale window, it doesn't remove it. The result was the owner's edits appearing
 * to "revert" in /admin and lagging on the live site. A brand-new URL has nothing
 * cached, so the edit is visible immediately everywhere. Do not switch back to a
 * stable key + allowOverwrite.
 */
export async function setContent(content: SiteContent): Promise<void> {
  const key = `${CONTENT_PREFIX}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.json`;
  await put(key, JSON.stringify(content, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    cacheControlMaxAge: 0,
  });
  // Best-effort: delete older versions so they don't accumulate. getContent()
  // always reads the newest, so a missed prune is harmless.
  try {
    const { blobs } = await list({ prefix: CONTENT_PREFIX });
    const older = blobs
      .sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt))
      .slice(1);
    await Promise.all(older.map((b) => del(b.url)));
  } catch {
    // ignore — extra stale copies don't affect correctness
  }
}

/**
 * Upload a single image binary and return its public URL. A random suffix makes
 * the pathname unique per upload (the returned URL is what we store, so stability
 * isn't needed), so two uploads can never collide.
 */
export async function uploadPhoto(
  file: Blob,
  originalName: string
): Promise<{ url: string; pathname: string }> {
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const blob = await put(`photos/${safeName}`, file, {
    access: "public",
    addRandomSuffix: true,
    allowOverwrite: false,
  });
  return { url: blob.url, pathname: blob.pathname };
}

/**
 * Best-effort delete of a previously uploaded photo. Failures are swallowed —
 * what's visible on the site is governed by the URLs stored in site.json, not by
 * whether the old blob still exists.
 */
export async function deletePhotoByUrl(url: string): Promise<void> {
  try {
    await del(url);
  } catch {
    // ignore — site.json is the source of truth for what's shown
  }
}

/** True for URLs we created in Vercel Blob (safe to delete on replace). */
export function isManagedBlobUrl(url: string): boolean {
  return url.startsWith("https://") && url.includes(".blob.vercel-storage.com");
}

// ─── Sanitiser helpers ──────────────────────────────────────────────────────
// The saved blob is just JSON and could, in principle, be malformed, corrupted,
// or written by an older/newer schema. Any throw while rendering the page
// (e.g. `.map` on a missing array) would white-screen the whole live site. So
// every field is coerced to a safe shape here, before it ever reaches the
// renderer. These helpers are the building blocks for mergeWithDefaults below.

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

/** Filter to non-empty strings; fall back to defaults if nothing usable. */
function strArray(v: unknown, fallback: string[]): string[] {
  if (!Array.isArray(v)) return fallback;
  const out = v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  return out.length > 0 ? out : fallback;
}

/** A fixed photo slot: coerce src + caption, falling back per field. */
function photo(v: unknown, fallback: Photo): Photo {
  const p = asRecord(v);
  if (!p) return fallback;
  return { src: str(p.src, fallback.src), caption: str(p.caption, fallback.caption) };
}

/**
 * A gallery (add/remove/reorder photo list): backfill missing ids, drop items
 * without a src (no src => broken image on the live site).
 */
function gallery(v: unknown, fallback: GalleryPhoto[], idPrefix: string): GalleryPhoto[] {
  if (!Array.isArray(v)) return fallback;
  return v
    .map((raw, i) => {
      const g = asRecord(raw);
      if (!g) return null;
      return { id: str(g.id, `${idPrefix}-${i}`), src: str(g.src), caption: str(g.caption) };
    })
    .filter((g): g is GalleryPhoto => !!g && !!g.src);
}

// Some sanitiser helpers are only used by the generated mergeWithDefaults —
// reference them here so the shipped stub compiles lint-clean.
void bool;
void strArray;
void photo;
void gallery;

// ─── SITE-SPECIFIC (generated per site by the cms skill) ────────────────────
//
// Defensive merge: coerce EVERY field of the saved JSON to a safe shape so an
// older/malformed saved blob, or a model change, can never break the renderer.
//
// Generation rules (see the cms skill for the full contract):
//   - Every scalar:  str(data.x, dc.x) / bool(data.x, dc.x)
//   - Every string[]: strArray(data.x, dc.x)
//   - Every fixed photo slot: photo(data.x, dc.x)
//   - Every gallery: gallery(data.x, dc.x, "prefix")
//   - Lists of objects (services, reviews, price items…): map with per-item
//     coercion, backfill id `${prefix}-${i}`, drop items with no usable text,
//     fall back to the default list when nothing usable remains.
//   - Fixed-length photo arrays (e.g. exactly two case-study slots): ALWAYS
//     return the exact length by index — if the array were ever shorter, the
//     admin's slot targets would index past the end and silently no-op.

function mergeWithDefaults(data: Partial<SiteContent>): SiteContent {
  // cms-generate: replace this stub with the per-field merge for this site's
  // content model. The site must not ship until this is generated.
  void data;
  throw new Error("cms-generate: mergeWithDefaults has not been generated yet");
}
