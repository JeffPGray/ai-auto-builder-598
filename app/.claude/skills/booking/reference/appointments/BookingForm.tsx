"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Public booking form (appointments variant). Installed by the Klaudius
 * booking skill as `src/app/book/BookingForm.tsx`.
 *
 * booking-restyle: the Tailwind classes below are a NEUTRAL placeholder skin.
 * Restyle them to match this site's design system — classes and copy only.
 * NEVER change the logic: the honeypot field, the availability refetch on
 * conflict, the state machine and the error handling are proven plumbing.
 * Customer-facing strings must be in the operator's language if it isn't
 * English.
 */

export interface ServiceOption {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  priceLabel: string;
  staff: { id: string; name: string }[];
}

export interface BookingFormConfig {
  businessName: string;
  businessPhone: string;
  locale: string;
  services: ServiceOption[];
  todayStr: string; // today in the business timezone (server-computed)
  maxDateStr: string; // last bookable date (server-computed)
  cutoffHours: number;
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

interface TimeOption {
  startTime: string;
  label: string;
  staff: { id: string; name: string }[];
}

interface SuccessInfo {
  bookingRef: string;
  date: string;
  timeLabel: string;
  serviceName: string;
  staffName: string;
}

export default function BookingForm({ cfg }: { cfg: BookingFormConfig }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [service, setService] = useState<ServiceOption | null>(null);
  const [date, setDate] = useState("");
  const [staffPref, setStaffPref] = useState<string | null>(null); // null = any
  const [times, setTimes] = useState<TimeOption[] | null>(null);
  const [availReason, setAvailReason] = useState<string | null>(null);
  const [loadingTimes, setLoadingTimes] = useState(false);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);

  // Only show a staff picker when there's a genuine choice.
  const staffChoices = service && service.staff.length > 1 ? service.staff : null;

  const loadTimes = useCallback(async () => {
    if (!service || !date) {
      // Selection cleared — drop stale times so an old pick can't be submitted.
      setTimes(null);
      setSelectedTime(null);
      setAvailReason(null);
      return;
    }
    setLoadingTimes(true);
    setTimes(null);
    setAvailReason(null);
    setSelectedTime(null);
    try {
      const staffParam = staffPref ? `&staff=${encodeURIComponent(staffPref)}` : "";
      const res = await fetch(
        `/api/booking/availability?date=${encodeURIComponent(date)}&service=${encodeURIComponent(service.id)}${staffParam}`
      );
      const json = await res.json();
      if (!res.ok) {
        setAvailReason(json.error ?? "Something went wrong. Please try again.");
        return;
      }
      if (json.reason === "outside_window") {
        setAvailReason("That date is outside our online booking window.");
        return;
      }
      if (json.reason === "date_closed" || json.reason === "off_service") {
        setAvailReason("We're closed on that day. Please pick another date.");
        return;
      }
      if (json.reason === "cutoff_passed") {
        setAvailReason("Online booking for that day has closed. Please pick a later date.");
        return;
      }
      const t = json.times as TimeOption[];
      if (t.length === 0) {
        setAvailReason("Fully booked that day. Please try another date.");
        return;
      }
      setTimes(t);
    } catch {
      setAvailReason("Couldn't check availability. Please try again.");
    } finally {
      setLoadingTimes(false);
    }
  }, [service, date, staffPref]);

  useEffect(() => {
    void loadTimes();
  }, [loadTimes]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!service || !date || !selectedTime) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          startTime: selectedTime,
          serviceId: service.id,
          staffId: staffPref,
          name,
          phone,
          email,
          notes,
          website: "", // honeypot — must be present and empty
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        // 409 = the time got taken (or closed) between choosing and
        // submitting. Back to the time picker with fresh availability.
        if (res.status === 409) {
          setError(json.error ?? "That time is no longer available. Please pick another.");
          setStep(2);
          await loadTimes();
        } else {
          setError(apiErrorMessage(json));
        }
        return;
      }
      const chosen = times?.find((t) => t.startTime === selectedTime);
      setSuccess({
        bookingRef: json.bookingRef,
        date,
        timeLabel: chosen?.label ?? selectedTime,
        serviceName: service.name,
        staffName: json.booking?.staffName ?? "",
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
        <h2 className="text-2xl font-bold text-neutral-900">Appointment confirmed</h2>
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
          {success.serviceName}
          {success.staffName ? ` with ${success.staffName}` : ""} ·{" "}
          {longDate(success.date, cfg.locale)} · {success.timeLabel}
        </p>
        <p className="mt-4 text-xs text-neutral-500">
          Plans change? Your confirmation email has a cancellation link (up to {cfg.cutoffHours}{" "}
          hours before your appointment).
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
          <span className="mb-2 block text-sm font-semibold text-neutral-700">
            Choose a service
          </span>
          <div className="grid gap-3">
            {cfg.services.map((sv) => {
              const selected = service?.id === sv.id;
              return (
                <button
                  key={sv.id}
                  type="button"
                  onClick={() => {
                    setService(sv);
                    setStaffPref(null);
                    setSelectedTime(null);
                  }}
                  className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                    selected
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : "border-neutral-300 bg-white text-neutral-900 hover:border-neutral-500"
                  }`}
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">{sv.name}</span>
                    <span className={`text-sm ${selected ? "text-white/80" : "text-neutral-600"}`}>
                      {sv.priceLabel}
                    </span>
                  </span>
                  <span className={`mt-0.5 block text-xs ${selected ? "text-white/70" : "text-neutral-500"}`}>
                    {sv.durationMinutes} min{sv.description ? ` · ${sv.description}` : ""}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            disabled={!service}
            onClick={() => setStep(2)}
            className="mt-6 w-full rounded-lg bg-neutral-900 px-4 py-3 font-semibold text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Continue
          </button>
        </div>
      )}

      {step === 2 && service && (
        <div>
          <button
            type="button"
            onClick={() => setStep(1)}
            className="mb-4 text-sm text-neutral-500 underline-offset-2 hover:underline"
          >
            ← Change service
          </button>
          <p className="mb-5 rounded-lg bg-neutral-100 px-4 py-3 text-sm text-neutral-700">
            {service.name} · {service.durationMinutes} min
            {service.priceLabel ? ` · ${service.priceLabel}` : ""}
          </p>

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
            {staffChoices && (
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-neutral-700">With</span>
                <select
                  value={staffPref ?? ""}
                  onChange={(e) => setStaffPref(e.target.value || null)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-neutral-900 focus:border-neutral-500 focus:outline-none"
                >
                  <option value="">Anyone available</option>
                  {staffChoices.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {loadingTimes && <p className="mt-5 text-sm text-neutral-500">Checking availability…</p>}
          {availReason && !loadingTimes && (
            <p className="mt-5 text-sm text-neutral-600">{availReason}</p>
          )}

          {times && !loadingTimes && (
            <div className="mt-5">
              <span className="mb-2 block text-sm font-semibold text-neutral-700">Time</span>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {times.map((t) => {
                  const selected = selectedTime === t.startTime;
                  return (
                    <button
                      key={t.startTime}
                      type="button"
                      onClick={() => setSelectedTime(t.startTime)}
                      className={`rounded-lg border px-2 py-2 text-sm font-semibold transition-colors ${
                        selected
                          ? "border-neutral-900 bg-neutral-900 text-white"
                          : "border-neutral-300 bg-white text-neutral-900 hover:border-neutral-500"
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                disabled={!selectedTime}
                onClick={() => {
                  setError(null);
                  setStep(3);
                }}
                className="mt-6 w-full rounded-lg bg-neutral-900 px-4 py-3 font-semibold text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Continue
              </button>
            </div>
          )}
        </div>
      )}

      {step === 3 && service && (
        <form onSubmit={submit}>
          <button
            type="button"
            onClick={() => setStep(2)}
            className="mb-4 text-sm text-neutral-500 underline-offset-2 hover:underline"
          >
            ← Change date or time
          </button>
          <p className="mb-5 rounded-lg bg-neutral-100 px-4 py-3 text-sm text-neutral-700">
            {service.name} · {longDate(date, cfg.locale)} ·{" "}
            {times?.find((t) => t.startTime === selectedTime)?.label ?? selectedTime}
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
                Notes <span className="font-normal text-neutral-400">(optional)</span>
              </span>
              <textarea
                maxLength={500}
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
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
            {submitting ? "Booking…" : "Confirm appointment"}
          </button>
          <p className="mt-3 text-center text-xs text-neutral-500">
            You'll get an email confirmation with a cancellation link.
          </p>
        </form>
      )}
    </div>
  );
}
