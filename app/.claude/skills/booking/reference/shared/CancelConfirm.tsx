"use client";

import { useState } from "react";

/**
 * Cancel confirmation button + result states. Installed by the Klaudius
 * booking skill as `src/app/book/cancel/[token]/CancelConfirm.tsx` (both
 * variants share this file).
 *
 * booking-restyle: classes and copy only — keep the states and the API call.
 */

export default function CancelConfirm({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "already">("idle");
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setState("busy");
    setError(null);
    try {
      const res = await fetch("/api/booking/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Something went wrong. Please try again.");
        setState("idle");
        return;
      }
      setState(json.alreadyCancelled ? "already" : "done");
    } catch {
      setError("Something went wrong. Please check your connection and try again.");
      setState("idle");
    }
  }

  if (state === "done" || state === "already") {
    return (
      <div className="mt-5 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        {state === "done"
          ? "Your booking has been cancelled. A confirmation email is on its way."
          : "This booking was already cancelled."}
      </div>
    );
  }

  return (
    <div className="mt-5">
      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={cancel}
        disabled={state === "busy"}
        className="w-full rounded-lg border border-red-300 bg-white px-4 py-3 font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-60"
      >
        {state === "busy" ? "Cancelling…" : "Yes, cancel my booking"}
      </button>
      <p className="mt-3 text-center text-xs text-neutral-500">
        Changed your mind? Just close this page — your booking stays as it is.
      </p>
    </div>
  );
}
