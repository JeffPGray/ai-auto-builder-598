"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Photo upload control that shrinks + auto-rotates the image in the browser
 * BEFORE sending it to the server.
 *
 * Why client-side: a phone photo is 3-12 MB, but Vercel functions reject request
 * bodies over 4.5 MB and Next.js server actions over 1 MB by default. Compressing
 * here (to ~1600px / ~0.8 MB) keeps every upload comfortably under those limits AND
 * keeps the live site fast, since the images are served unoptimised.
 *
 * The selected file is read via ref, compressed, then handed to the given server
 * action as FormData; router.refresh() re-reads the dashboard so the change shows.
 *
 * Installed by the Klaudius cms skill. Owner-facing strings below must be
 * written in the operator's language if it isn't English.
 */
export default function PhotoUploader({
  action,
  hidden = {},
  withCaption = false,
  buttonLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  hidden?: Record<string, string>;
  withCaption?: boolean;
  buttonLabel: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const captionRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "info" | "error" | "ok"; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setMsg({ kind: "error", text: "Choose a photo first." });
      return;
    }

    setBusy(true);
    try {
      setMsg({ kind: "info", text: "Optimising photo…" });
      let compressed: Blob;
      try {
        // Browser-only library; load it lazily so it never evaluates during SSR.
        const { default: imageCompression } = await import("browser-image-compression");
        compressed = await imageCompression(file, {
          maxWidthOrHeight: 1600,
          maxSizeMB: 0.8,
          useWebWorker: true,
          fileType: "image/jpeg",
          initialQuality: 0.8,
        });
      } catch {
        // Most common cause: a HEIC photo on a browser that can't decode it.
        const isHeic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
        throw new Error(
          isHeic
            ? "That looks like an iPhone HEIC photo this browser can't read. On your phone it usually works; on a computer, save it as a JPG first."
            : "Couldn't read that image — please try a JPG or PNG."
        );
      }

      const fd = new FormData();
      for (const [k, v] of Object.entries(hidden)) fd.append(k, v);
      if (withCaption) fd.append("caption", captionRef.current?.value ?? "");
      const base = file.name.replace(/\.[^.]+$/, "") || "photo";
      fd.append("file", compressed, `${base}.jpg`);

      setMsg({ kind: "info", text: "Uploading…" });
      await action(fd);

      setMsg({ kind: "ok", text: "Saved — it's live on your site." });
      if (fileRef.current) fileRef.current.value = "";
      if (captionRef.current) captionRef.current.value = "";
      router.refresh();
    } catch (err) {
      setMsg({
        kind: "error",
        text:
          err instanceof Error && err.message
            ? err.message
            : "Upload failed — please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 text-sm">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        required
        disabled={busy}
        className="block w-full text-sm text-[#57534E] file:mr-3 file:rounded-lg file:border-0 file:bg-[#292524] file:px-4 file:py-2 file:text-white file:font-semibold hover:file:bg-black disabled:opacity-50"
      />
      {withCaption && (
        <input
          ref={captionRef}
          type="text"
          placeholder="Optional caption"
          disabled={busy}
          className="w-full bg-white border border-[#292524]/15 rounded-lg px-3 py-2 text-sm text-[#292524] focus:outline-none focus:ring-2 focus:ring-[#292524] focus:border-transparent disabled:opacity-50"
        />
      )}
      <button
        type="submit"
        disabled={busy}
        className="bg-[#292524] hover:bg-black text-white px-5 py-2.5 rounded-lg text-sm font-bold transition-colors disabled:opacity-60"
      >
        {busy ? "Working…" : buttonLabel}
      </button>
      {msg && (
        <p
          className={
            msg.kind === "error"
              ? "text-xs text-[#B91C1C]"
              : msg.kind === "ok"
                ? "text-xs text-[#15803D]"
                : "text-xs text-[#57534E]"
          }
        >
          {msg.text}
        </p>
      )}
    </form>
  );
}
