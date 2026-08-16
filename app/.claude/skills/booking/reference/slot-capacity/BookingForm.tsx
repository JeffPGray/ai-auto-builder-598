"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Public booking form (slot-capacity variant). Installed by the Klaudius
 * booking skill as `src/app/book/BookingForm.tsx`.
 *
 * booking-restyle: the Tailwind classes below are a NEUTRAL placeholder skin.
 * Restyle them to match this site's design system (palette, fonts, radii,
 * button styles) — classes and copy only. NEVER change the logic: the
 * honeypot field, the availability refetch on conflict, the state machine and
 * the error handling are proven plumbing. Customer-facing strings must be in
 * the operator's language if it isn't English.
 */

export interface BookingFormConfig {
  businessName: string;
  businessPhone: string;
  locale: string;
  slotTimes: string[];
  minParty: number;
  maxParty: number;
  todayStr: string; // today in the business timezone (server-computed)
  maxDateStr: string; // last bookable date (server-computed)
  cutoffHours: number;
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

/** Surface per-field validation details when the API provides them. */
function apiErrorMessage(json: { error?: string; details?: Record<string, string[]> }): string {
  if (json.details) {
    const fields = Object.values(json.details).flat();
    if (fields.length > 0) return fields.join(" ");
  }
  return json.error ?? "Something went wrong. Please try again.";
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

interface SuccessInfo {
  bookingRef: string;
  date: string;
  slotLabel: string;
  partySize: number;
}

export default function BookingForm({ cfg }: { cfg: BookingFormConfig }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [date, setDate] = useState("");
  const [party, setParty] = useState(cfg.minParty);
  const [slots, setSlots] = useState<SlotOption[] | null>(null);
  const [availReason, setAvailReason] = useState<string | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [requests, setRequests] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);

  const partyOptions: number[] = [];
  for (let n = cfg.minParty; n <= cfg.maxParty; n++) partyOptions.push(n);

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
        `/api/booking/availability?date=${encodeURIComponent(date)}&party=${party}`
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
  }, [date, party, cfg.openDayLabels]);

  useEffect(() => {
    void loadAvailability();
  }, [loadAvailability]);

  function slotStatus(sl: SlotOption): string | null {
    if (sl.closed) return "Closed";
    if (!sl.canFitParty) return "Fully booked";
    if (sl.cutoffPassed) return "Online booking closed";
    return null;
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!date || !selectedSlot) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          slotTime: selectedSlot,
          partySize: party,
          name,
          phone,
          email,
          specialRequests: requests,
          website: "", // honeypot — must be present and empty
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        // 409 = the slot filled up (or closed) between choosing and submitting.
        // Send the customer back to pick again with fresh availability.
        if (res.status === 409) {
          setError(json.error ?? "That time is no longer available. Please pick another.");
          setStep(1);
          await loadAvailability();
        } else {
          setError(apiErrorMessage(json));
        }
        return;
      }
      const chosen = slots?.find((sl) => sl.slotTime === selectedSlot);
      setSuccess({
        bookingRef: json.bookingRef,
        date,
        slotLabel: chosen?.label ?? selectedSlot,
        partySize: party,
      });
    } catch {
      setError("Something went wrong. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Success panel ──────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center">
        <h2 className="text-2xl font-bold text-neutral-900">Booking confirmed</h2>
        <p className="mt-2 text-neutral-600">
          Thank you, we look forward to seeing you. A confirmation email is on its way.
        </p>
        <div className="mx-auto mt-6 max-w-xs rounded-lg bg-neutral-100 px-6 py-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Booking reference</div>
          <div className="mt-1 text-xl font-bold tracking-widest text-neutral-900">
            {success.bookingRef}
          </div>
        </div>
        <p className="mt-6 text-sm text-neutral-600">
          {longDate(success.date, cfg.locale)} · {success.slotLabel} ·{" "}
          {success.partySize} {success.partySize === 1 ? "guest" : "guests"}
        </p>
        <p className="mt-4 text-xs text-neutral-500">
          Plans change? Your confirmation email has a cancellation link (up to {cfg.cutoffHours}{" "}
          hours before your booking).
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6 sm:p-8">
      {error && (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {step === 1 && (
        <div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-neutral-700">Date</span>
              <input
                type="date"
                value={date}
                min={cfg.todayStr}
                max={cfg.maxDateStr}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-neutral-900 focus:border-neutral-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-neutral-700">Guests</span>
              <select
                value={party}
                onChange={(e) => setParty(parseInt(e.target.value, 10))}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-neutral-900 focus:border-neutral-500 focus:outline-none"
              >
                {partyOptions.map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? "guest" : "guests"}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {!date && (
            <p className="mt-5 text-sm text-neutral-500">
              We're open {cfg.openDayLabels.join(", ")}. Pick a date to see available times.
            </p>
          )}
          {loadingSlots && <p className="mt-5 text-sm text-neutral-500">Checking availability…</p>}
          {availReason && !loadingSlots && (
            <p className="mt-5 text-sm text-neutral-600">{availReason}</p>
          )}

          {slots && !loadingSlots && (
            <div className="mt-5">
              <span className="mb-2 block text-sm font-semibold text-neutral-700">Time</span>
              <div className="grid gap-3 sm:grid-cols-2">
                {slots.map((sl) => {
                  const status = slotStatus(sl);
                  const selected = selectedSlot === sl.slotTime;
                  return (
                    <button
                      key={sl.slotTime}
                      type="button"
                      disabled={!sl.bookable}
                      onClick={() => setSelectedSlot(sl.slotTime)}
                      className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                        selected
                          ? "border-neutral-900 bg-neutral-900 text-white"
                          : sl.bookable
                            ? "border-neutral-300 bg-white text-neutral-900 hover:border-neutral-500"
                            : "cursor-not-allowed border-neutral-200 bg-neutral-50 text-neutral-400"
                      }`}
                    >
                      <span className="block font-semibold">{sl.label}</span>
                      <span className={`block text-xs ${selected ? "text-white/70" : "text-neutral-500"}`}>
                        {status ?? (
                          // Honest scarcity only: show "last few places" only when
                          // genuinely true. Never fabricate urgency.
                          sl.coversRemaining <= Math.max(2, party)
                            ? "Almost full"
                            : "Available"
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                disabled={!selectedSlot}
                onClick={() => {
                  setError(null);
                  setStep(2);
                }}
                className="mt-6 w-full rounded-lg bg-neutral-900 px-4 py-3 font-semibold text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Continue
              </button>
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <form onSubmit={submit}>
          <button
            type="button"
            onClick={() => setStep(1)}
            className="mb-4 text-sm text-neutral-500 underline-offset-2 hover:underline"
          >
            ← Change date or time
          </button>
          <p className="mb-5 rounded-lg bg-neutral-100 px-4 py-3 text-sm text-neutral-700">
            {longDate(date, cfg.locale)} ·{" "}
            {slots?.find((sl) => sl.slotTime === selectedSlot)?.label ?? selectedSlot} ·{" "}
            {party} {party === 1 ? "guest" : "guests"}
          </p>

          <div className="grid gap-4">
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-neutral-700">Your name</span>
              <input
                type="text"
                required
                minLength={2}
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 focus:border-neutral-500 focus:outline-none"
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-neutral-700">Phone</span>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 focus:border-neutral-500 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-neutral-700">Email</span>
                <input
                  type="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 focus:border-neutral-500 focus:outline-none"
                />
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-neutral-700">
                Special requests <span className="font-normal text-neutral-400">(optional)</span>
              </span>
              <textarea
                maxLength={500}
                rows={3}
                value={requests}
                onChange={(e) => setRequests(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 focus:border-neutral-500 focus:outline-none"
              />
            </label>
            {/* Honeypot — hidden from humans, required-empty for the API. */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value=""
              onChange={() => {}}
              className="hidden"
              aria-hidden="true"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="mt-6 w-full rounded-lg bg-neutral-900 px-4 py-3 font-semibold text-white transition-colors hover:bg-neutral-700 disabled:opacity-60"
          >
            {submitting ? "Booking…" : "Confirm booking"}
          </button>
          <p className="mt-3 text-center text-xs text-neutral-500">
            You'll get an email confirmation with a cancellation link.
          </p>
        </form>
      )}
    </div>
  );
}
