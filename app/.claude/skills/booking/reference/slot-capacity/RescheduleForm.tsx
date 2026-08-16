"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Self-service reschedule picker, rendered on the /book/cancel/[token] page
 * above the cancel button (slot-capacity variant). Installed by the Klaudius
 * booking skill as `src/app/book/cancel/[token]/RescheduleForm.tsx`.
 *
 * Party size is fixed to what was booked — a reschedule moves the time only.
 *
 * booking-restyle: the Tailwind classes below are a NEUTRAL placeholder skin —
 * restyle classes and copy only. NEVER change the logic: the availability
 * refetch on conflict, the state machine and the error handling are proven
 * plumbing (mirrors BookingForm).
 */

export interface RescheduleFormConfig {
  token: string;
  partySize: number;
  todayStr: string; // today in the business timezone (server-computed)
  maxDateStr: string; // last bookable date (server-computed)
  locale: string;
  businessPhone: string;
  openDayLabels: string[]; // localized weekday names the business opens
}

/** "Friday 17 July" from YYYY-MM-DD, in the business locale. */
function longDate(dateStr: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${dateStr}T12:00:00Z`));
}

interface SlotOption {
  slotTime: string;
  label: string;
  coversRemaining: number;
  canFitParty: boolean;
  cutoffPassed: boolean;
  closed: boolean;
  bookable: boolean;
}

interface DoneInfo {
  bookingRef: string;
  date: string;
  slotLabel: string;
}

export default function RescheduleForm({ cfg }: { cfg: RescheduleFormConfig }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<SlotOption[] | null>(null);
  const [availReason, setAvailReason] = useState<string | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<DoneInfo | null>(null);

  const loadAvailability = useCallback(async () => {
    if (!date) {
      // Date cleared — drop stale slots so an old selection can't be submitted.
      setSlots(null);
      setSelectedSlot(null);
      setAvailReason(null);
      return;
    }
    setLoadingSlots(true);
    setSlots(null);
    setAvailReason(null);
    setSelectedSlot(null);
    try {
      const res = await fetch(
        `/api/booking/availability?date=${encodeURIComponent(date)}&party=${cfg.partySize}`
      );
      const json = await res.json();
      if (!res.ok) {
        setAvailReason(json.error ?? "Something went wrong. Please try again.");
        return;
      }
      if (json.reason === "off_service") {
        setAvailReason(
          `We take bookings on ${cfg.openDayLabels.join(", ")}. Please pick one of those days.`
        );
        return;
      }
      if (json.reason === "outside_window") {
        setAvailReason("That date is outside our online booking window.");
        return;
      }
      setSlots(json.slots as SlotOption[]);
    } catch {
      setAvailReason("Couldn't check availability. Please try again.");
    } finally {
      setLoadingSlots(false);
    }
  }, [date, cfg.partySize, cfg.openDayLabels]);

  useEffect(() => {
    if (open) void loadAvailability();
  }, [open, loadAvailability]);

  function slotStatus(sl: SlotOption): string | null {
    if (sl.closed) return "Closed";
    if (!sl.canFitParty) return "Fully booked";
    if (sl.cutoffPassed) return "Online booking closed";
    return null;
  }

  async function submit() {
    if (!date || !selectedSlot) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/booking/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: cfg.token, date, slotTime: selectedSlot }),
      });
      const json = await res.json();
      if (!res.ok) {
        // 409 = the slot filled up (or the booking changed) between choosing
        // and submitting. Surface it and refresh availability.
        setError(json.error ?? "That time is no longer available. Please pick another.");
        if (res.status === 409) await loadAvailability();
        return;
      }
      const chosen = slots?.find((sl) => sl.slotTime === selectedSlot);
      setDone({
        bookingRef: json.bookingRef,
        date,
        slotLabel: chosen?.label ?? selectedSlot,
      });
      // The old token is now cancelled, so everything else on this page (the
      // cancel button below) is bound to a dead booking. Reload onto the NEW
      // booking's manage page — replace(), not push, so Back doesn't return
      // to the stale token.
      if (json.cancelUrl) window.location.replace(json.cancelUrl);
    } catch {
      setError("Something went wrong. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    // Shown only for the moment before the redirect above lands (or if it
    // fails) — the email link always reaches the new manage page regardless.
    return (
      <div className="mt-6 rounded-lg border border-green-200 bg-green-50 px-4 py-4">
        <p className="font-semibold text-green-900">Booking moved</p>
        <p className="mt-1 text-sm text-green-800">
          {longDate(done.date, cfg.locale)}, {done.slotLabel} ·{" "}
          {cfg.partySize} {cfg.partySize === 1 ? "guest" : "guests"} · new reference{" "}
          <strong>{done.bookingRef}</strong>
        </p>
        <p className="mt-2 text-xs text-green-700">
          Taking you to your updated booking… A new confirmation email is on its way.
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-6 w-full rounded-lg border border-neutral-900 px-4 py-3 font-semibold text-neutral-900 transition-colors hover:bg-neutral-100"
      >
        Pick a new time instead
      </button>
    );
  }

  return (
    <div className="mt-6 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-neutral-700">
          New time for {cfg.partySize} {cfg.partySize === 1 ? "guest" : "guests"}
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-neutral-500 underline-offset-2 hover:underline"
        >
          Never mind
        </button>
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        Party size stays as booked — to change it, please call
        {cfg.businessPhone ? ` ${cfg.businessPhone}` : " us"}.
      </p>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <label className="mt-3 block">
        <span className="mb-1 block text-xs font-semibold text-neutral-600">Date</span>
        <input
          type="date"
          value={date}
          min={cfg.todayStr}
          max={cfg.maxDateStr}
          onChange={(e) => setDate(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-neutral-900 focus:border-neutral-500 focus:outline-none"
        />
      </label>

      {loadingSlots && <p className="mt-3 text-sm text-neutral-500">Checking availability…</p>}
      {availReason && !loadingSlots && (
        <p className="mt-3 text-sm text-neutral-600">{availReason}</p>
      )}

      {slots && !loadingSlots && (
        <div className="mt-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {slots.map((sl) => {
              const status = slotStatus(sl);
              const selected = selectedSlot === sl.slotTime;
              return (
                <button
                  key={sl.slotTime}
                  type="button"
                  disabled={!sl.bookable}
                  onClick={() => setSelectedSlot(sl.slotTime)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    selected
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : sl.bookable
                        ? "border-neutral-300 bg-white text-neutral-900 hover:border-neutral-500"
                        : "cursor-not-allowed border-neutral-200 bg-neutral-50 text-neutral-400"
                  }`}
                >
                  <span className="block font-semibold">{sl.label}</span>
                  {status && (
                    <span className={`block text-xs ${selected ? "text-white/70" : "text-neutral-500"}`}>
                      {status}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            disabled={!selectedSlot || submitting}
            onClick={() => void submit()}
            className="mt-4 w-full rounded-lg bg-neutral-900 px-4 py-3 font-semibold text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "Moving…" : "Move my booking"}
          </button>
        </div>
      )}
    </div>
  );
}
