"use server";

/**
 * Server actions for the /admin CMS: login/logout + every content edit.
 *
 * Installed by the Klaudius cms skill. Everything above the SITE-SPECIFIC
 * marker is generic plumbing — do not edit per site. The section actions at
 * the bottom are generated per site from this site's content model.
 *
 * NOTE (owner-facing strings): error messages RETURNED as values (e.g.
 * loginAction's { error }) reach the owner verbatim — write them in the
 * operator's language if it isn't English. Messages THROWN from actions are
 * redacted by Next.js in production builds: for form-action submits the owner
 * lands on the admin error page (admin-error.tsx) instead, so that page's
 * copy is what matters; throws that surface through PhotoUploader show a
 * generic redacted message in prod. Keep thrown errors for the
 * shouldn't-happen paths and returned values for anything the owner is
 * expected to see.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  SESSION_COOKIE_NAME,
  isValidPassword,
  signSession,
  sessionCookieOptions,
  verifySession,
} from "./auth";
import {
  getContent,
  setContent,
  uploadPhoto,
  deletePhotoByUrl,
  isManagedBlobUrl,
} from "./blob";
import type { SiteContent } from "./content";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Authorisation gate. Server Actions are PUBLIC POST endpoints — the
 * proxy/middleware gate does NOT protect them, because they're co-hosted on the
 * whitelisted /admin/login route and dispatched by a public action id. So every
 * action that reads private state or mutates content/Blob storage MUST verify
 * the session itself. Without this, anyone could rewrite the live site or spam
 * Blob uploads. NEVER remove this call from an action.
 */
async function requireSession(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!(await verifySession(token))) {
    throw new Error("Not authorised — please sign in again.");
  }
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function refreshAfterEdit(): Promise<void> {
  // Invalidate the homepage so the next visitor sees the change immediately.
  // If this site has more content-driven routes, revalidate each of them here.
  revalidatePath("/");
}

function readString(form: FormData, key: string, fallback = ""): string {
  const v = form.get(key);
  return typeof v === "string" ? v : fallback;
}

function readBool(form: FormData, key: string): boolean {
  // An unchecked checkbox submits nothing; a checked one submits a value.
  return form.get(key) != null;
}

/** Split a textarea into lines, trimming and dropping blanks. */
function readLines(form: FormData, key: string): string[] {
  return readString(form, key)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Split a textarea into paragraphs on blank lines. */
function readParagraphs(form: FormData, key: string): string[] {
  return readString(form, key)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Validate an uploaded image: present, non-empty, an image, and within the cap. */
function readImageFile(form: FormData, fallbackName: string): { file: Blob; filename: string } {
  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    throw new Error("No photo uploaded.");
  }
  if (!file.type.startsWith("image/")) {
    throw new Error("That file isn't an image — please choose a photo.");
  }
  // Backstop only — the browser compresses to well under 1 MB before this runs.
  if (file.size > 4 * 1024 * 1024) {
    throw new Error("Photo too large even after optimising — try a smaller one.");
  }
  const filename = file instanceof File && file.name ? file.name : fallbackName;
  return { file, filename };
}

/**
 * Swap an item one place up/down in a list by id. Returns the reordered list,
 * or null when the request is invalid / a no-op (already at the edge).
 */
function reorderById<T extends { id: string }>(
  items: T[],
  id: string,
  direction: string
): T[] | null {
  if (!id || !["up", "down"].includes(direction)) return null;
  const next = [...items];
  const idx = next.findIndex((it) => it.id === id);
  if (idx < 0) return null;
  const targetIdx = direction === "up" ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= next.length) return null;
  [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
  return next;
}

// Referenced by the generated section actions below; keeps the shipped stubs
// lint-clean until generation replaces them.
void newId;
void readBool;
void readLines;
void readParagraphs;
void reorderById;

// ─── Auth ───────────────────────────────────────────────────────────────────

export async function loginAction(
  _prev: unknown,
  form: FormData
): Promise<{ error?: string }> {
  const password = readString(form, "password");
  if (!password) return { error: "Enter the password to continue." };

  if (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) {
    return { error: "The editor isn't set up yet — contact your website provider." };
  }

  if (!isValidPassword(password)) {
    // Cheap brute-force throttle: make every failed attempt cost ~1.5s.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return { error: "Wrong password." };
  }

  let token: string;
  try {
    token = await signSession();
  } catch {
    return { error: "The editor isn't set up yet — contact your website provider." };
  }
  (await cookies()).set(SESSION_COOKIE_NAME, token, sessionCookieOptions);
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE_NAME);
  redirect("/admin/login");
}

// ─── Read helper used by the dashboard (guarded — also a public action id) ──

export async function fetchContent(): Promise<SiteContent> {
  await requireSession();
  return getContent();
}

// ─── Photos (replace + caption), shared across every photo slot ─────────────

export async function replacePhotoAction(form: FormData): Promise<void> {
  await requireSession();
  const target = readString(form, "target");
  const content = await getContent();
  const slot = resolvePhotoTarget(content, target);
  if (!slot) throw new Error("Unknown photo.");

  const { file, filename } = readImageFile(form, `${target}-${Date.now()}.jpg`);
  const { url } = await uploadPhoto(file, filename);

  await setContent(slot.apply(url));
  // Tidy up the photo we're replacing, but only if we uploaded it ourselves —
  // the build's original /images/... defaults and hotlinked photos stay put.
  if (isManagedBlobUrl(slot.current)) {
    await deletePhotoByUrl(slot.current);
  }
  await refreshAfterEdit();
}

export async function updateCaptionAction(form: FormData): Promise<void> {
  await requireSession();
  const target = readString(form, "target");
  const caption = readString(form, "caption").trim();
  const content = await getContent();
  const next = applyCaption(content, target, caption);
  if (!next) throw new Error("Unknown photo.");
  await setContent(next);
  await refreshAfterEdit();
}

// ─── SITE-SPECIFIC (generated per site by the cms skill) ────────────────────
//
// 1. resolvePhotoTarget — map every photo slot id used by the admin UI to its
//    current src and a setter. Fixed slots get simple ids ("hero", "about",
//    "cs-0", "cs-1"); gallery items use "work:<id>" style targets.
//
// 2. applyCaption — same mapping for caption edits (only for slots that show
//    a caption on the live site).
//
// 3. One exported action per editable section, plus add/update/delete/reorder
//    actions for each list (services, reviews, gallery, price list…). Every
//    one of them MUST start with `await requireSession()`. Patterns:
//      - Fixed section: read fields with readString/readBool/readLines/
//        readParagraphs, back-fill phone/email-style critical fields from the
//        existing value when left blank, setContent, refreshAfterEdit.
//      - List add: validate required fields, newId("svc"), append.
//      - List update: map over items matching readString(form, "id").
//      - List delete: filter by id (for galleries, also deletePhotoByUrl when
//        isManagedBlobUrl).
//      - List reorder: reorderById(content.<key>, id, direction); null = no-op.

function resolvePhotoTarget(
  content: SiteContent,
  target: string
): { current: string; apply: (src: string) => SiteContent } | null {
  // cms-generate: map this site's photo slots. The site must not ship until
  // this is generated.
  void content;
  void target;
  throw new Error("cms-generate: resolvePhotoTarget has not been generated yet");
}

function applyCaption(
  content: SiteContent,
  target: string,
  caption: string
): SiteContent | null {
  // cms-generate: map this site's captioned photo slots.
  void content;
  void target;
  void caption;
  throw new Error("cms-generate: applyCaption has not been generated yet");
}

// cms-generate: add this site's per-section actions below.
