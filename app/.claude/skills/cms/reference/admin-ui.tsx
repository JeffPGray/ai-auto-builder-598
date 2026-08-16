"use client";

/**
 * Shared building blocks for the /admin dashboard. The generated
 * src/app/admin/page.tsx composes its sections from these.
 *
 * Installed by the Klaudius cms skill as `src/app/admin/ui.tsx`. Generic
 * plumbing — do not edit per site, except to translate the owner-facing
 * strings (the aria-labels and the "Saving…" button state) when the
 * operator's language isn't English.
 *
 * This is a Client Component ("use client") so SubmitButton can read the
 * enclosing form's pending state via useFormStatus and show a "Saving…" /
 * disabled state. Every export here is a presentational building block; the
 * server page.tsx renders them and passes server actions in as props (the
 * standard RSC pattern). No server-only code lives in this file, so moving the
 * boundary to the client changes nothing about behaviour or data flow.
 *
 * Deliberately neutral monochrome palette: the admin is a back-office tool for
 * the site owner, not part of the brand site. Don't restyle it per site.
 */

import { useFormStatus } from "react-dom";
import PhotoUploader from "./PhotoUploader";
import { replacePhotoAction, updateCaptionAction } from "@/lib/actions";

export const inputCls =
  "w-full bg-white border border-[#292524]/15 rounded-lg px-3 py-2 text-sm text-[#292524] focus:outline-none focus:ring-2 focus:ring-[#292524] focus:border-transparent";

export const formCls = "mt-5 space-y-3 text-sm bg-white border border-[#292524]/10 rounded-xl p-5";

export const summaryCls = "cursor-pointer px-4 py-3 text-sm font-semibold text-[#292524] hover:underline";

export const editSummaryCls = "cursor-pointer px-4 py-2.5 text-xs font-semibold text-[#57534E] hover:text-[#292524]";

export function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header>
      <h2 className="text-xl font-black text-[#292524] leading-tight">{title}</h2>
      <p className="text-sm text-[#57534E] mt-1.5 leading-relaxed">{subtitle}</p>
    </header>
  );
}

export function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-xs font-semibold text-[#57534E] mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Save button for a section form. Reads the enclosing <form>'s pending state
 * via useFormStatus, so the owner gets feedback the instant they click Save:
 * the label switches to "Saving…" and the button disables (which also blocks
 * an accidental double-submit) until the server action settles, then returns
 * to its normal label. This is purely presentational — it never touches the
 * save / auth / storage path, so it cannot affect whether or what gets saved.
 * If ever rendered outside a <form>, useFormStatus harmlessly reports
 * pending=false and this behaves exactly like a plain submit button.
 */
export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="bg-[#292524] hover:bg-black text-white px-5 py-2.5 rounded-lg text-sm font-bold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {pending ? "Saving…" : children}
    </button>
  );
}

export function ReorderButton({
  id,
  direction,
  action,
}: {
  id: string;
  direction: "up" | "down";
  action: (form: FormData) => Promise<void>;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="direction" value={direction} />
      <button
        type="submit"
        aria-label={direction === "up" ? "Move up" : "Move down"}
        className="block w-7 h-7 rounded-md border border-[#292524]/15 text-[#57534E] hover:bg-[#292524] hover:text-white transition-colors"
      >
        {direction === "up" ? "▲" : "▼"}
      </button>
    </form>
  );
}

export function DeleteForm({ action, id, label }: { action: (form: FormData) => Promise<void>; id: string; label: string }) {
  return (
    <form action={action} className="border-t border-[#292524]/10">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="w-full px-4 py-2.5 text-xs font-semibold text-[#57534E] hover:bg-[#B91C1C] hover:text-white transition-colors text-left rounded-b-xl"
      >
        {label}
      </button>
    </form>
  );
}

export function Empty({ label }: { label: string }) {
  return (
    <li className="border border-dashed border-[#292524]/15 rounded-xl px-4 py-6 text-center text-sm text-[#57534E]">
      {label}
    </li>
  );
}

/** A fixed image slot: shows the current photo, lets the owner replace it, and (optionally) edit its caption. */
export function PhotoSlot({
  target,
  url,
  title,
  hint,
  caption,
  replaceLabel,
  captionSaveLabel,
}: {
  target: string;
  url: string;
  title: string;
  hint: string;
  caption?: string;
  replaceLabel: string;
  captionSaveLabel?: string;
}) {
  return (
    <div className="border border-[#292524]/10 bg-white rounded-xl p-4">
      <div className="flex gap-4 items-start">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={title} className="w-28 h-20 object-cover rounded-lg bg-[#F7F6F3] flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-[#292524] text-sm">{title}</p>
          <p className="text-xs text-[#57534E] mt-1">{hint}</p>
        </div>
      </div>
      {caption !== undefined && captionSaveLabel !== undefined && (
        <div className="mt-3">
          <CaptionForm target={target} caption={caption} saveLabel={captionSaveLabel} />
        </div>
      )}
      <div className="mt-3">
        <PhotoUploader action={replacePhotoAction} hidden={{ target }} buttonLabel={replaceLabel} />
      </div>
    </div>
  );
}

/** Tiny inline form to edit a photo's caption. */
export function CaptionForm({ target, caption, saveLabel }: { target: string; caption: string; saveLabel: string }) {
  return (
    <form action={updateCaptionAction} className="flex items-center gap-2">
      <input type="hidden" name="target" value={target} />
      <input name="caption" type="text" defaultValue={caption} placeholder="Caption" className={inputCls + " flex-1"} />
      <button type="submit" className="text-xs font-semibold text-[#292524] hover:underline whitespace-nowrap">
        {saveLabel}
      </button>
    </form>
  );
}

/** Link from the dashboard to the live site. Pass the label in the operator's language. */
export function ViewSiteLink({ label }: { label: string }) {
  return (
    <a
      href="/"
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 text-sm font-semibold text-[#292524] hover:underline underline-offset-4"
    >
      {label}
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M7 17 17 7" />
        <path d="M7 7h10v10" />
      </svg>
    </a>
  );
}
