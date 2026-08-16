"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Self-service reschedule picker, rendered on the /book/cancel/[token] page
 * above the cancel button (appointments variant). Installed by the Klaudius
 * booking skill as `src/app/book/cancel/[token]/RescheduleForm.tsx`.
 *
 * booking-restyle: the Tailwind classes below are a NEUTRAL placeholder skin —
 * restyle classes and copy only. NEVER change the logic: the availability
 * refetch on conflict, the state machine and the error handling are proven
 * plumbing (mirrors BookingForm).
 */

export interface RescheduleFormConfig {
  token: string;
  serviceId: string;
  serviceName: string;
  /** Staff who can perform this service; a picker shows only when >1. */
  staffChoices: { id: string; name: string }[];
  /** The currently booked staff member (preselected in the picker). */
  currentStaffId: string | null;
  todayStr: string; // today in the business timezone (server-computed)
  maxDateStr: string; // last bookable date (server-computed)
  locale: string;
  businessPhone: string;
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

interface TimeOption {
  startTime: string;
  label: string;
  staff: { id: string; name: string }[];
}

interface DoneInfo {
  bookingRef: string;
  date: string;
  timeLabel: string;
  staffName: string;
}

export default function RescheduleForm({ cfg }: { cfg: RescheduleFormConfig }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  // Preselect the booked staff member — but only if they still perform this
  // service; a stale id would silently filter availability to nothing.
  const [staffPref, setStaffPref] = useState<string | null>(
    cfg.currentStaffId && cfg.staffChoices.some((st) => st.id === cfg.currentStaffId)
      ? cfg.currentStaffId
      : null
  );
  const [times, setTimes] = useState<TimeOption[] | null>(null);
  const [availReason, setAvailReason] = useState<string | null>(null);
  const [loadingTimes, setLoadingTimes] = useState(false);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<DoneInfo | null>(null);

  const staffChoices = cfg.staffChoices.length > 1 ? cfg.staffChoices : null;

  const loadTimes = useCallback(async () => {
    if (!date) {
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
      // exclude = this appointment's token, so its own block doesn't hide the
      // nearby times the customer is most likely to move to.
      const res = await fetch(
        `/api/booking/availability?date=${encodeURIComponent(date)}&service=${encodeURIComponent(cfg.serviceId)}${staffParam}&exclude=${encodeURIComponent(cfg.token)}`
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
  }, [date, staffPref, cfg.serviceId]);

  useEffect(() => {
    if (open) void loadTimes();
  }, [open, loadTimes]);

  async function submit() {
    if (!date || !selectedTime) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/booking/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: cfg.token,
          date,
          startTime: selectedTime,
          staffId: staffPref,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        // 409 = the time got taken (or the appointment changed) between
        // choosing and submitting. Surface it and refresh availability.
        setError(json.error ?? "That time is no longer available. Please pick another.");
        if (res.status === 409) await loadTimes();
        return;
      }
      const chosen = times?.find((t) => t.startTime === selectedTime);
      setDone({
        bookingRef: json.bookingRef,
        date,
        timeLabel: chosen?.label ?? selectedTime,
        staffName: json.booking?.staffName ?? "",
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
        <p className="font-semibold text-green-900">Appointment moved</p>
        <p className="mt-1 text-sm text-green-800">
          {longDate(done.date, cfg.locale)}, {done.timeLabel}
          {done.staffName ? ` with ${done.staffName}` : ""} · new reference{" "}
          <strong>{done.bookingRef}</strong>
        </p>
        <p className="mt-2 text-xs text-green-700">
          Taking you to your updated appointment… A new confirmation email is on its way.
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
          New time for {cfg.serviceName}
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-neutral-500 underline-offset-2 hover:underline"
        >
          Never mind
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
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
        {staffChoices && (
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-neutral-600">With</span>
            <select
              value={staffPref ?? ""}
              onChange={(e) => setStaffPref(e.target.value || null)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-neutral-900 focus:border-neutral-500 focus:outline-none"
            >
              <option value="">No preference</option>
              {staffChoices.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {loadingTimes && <p className="mt-3 text-sm text-neutral-500">Checking availability…</p>}
      {availReason && !loadingTimes && (
        <p className="mt-3 text-sm text-neutral-600">{availReason}</p>
      )}

      {times && !loadingTimes && (
        <div className="mt-3">
          <div className="grid grid-cols-3 gap-2">
            {times.map((t) => (
              <button
                key={t.startTime}
                type="button"
                onClick={() => setSelectedTime(t.startTime)}
                className={`rounded-lg border px-2 py-2 text-sm font-semibold transition-colors ${
                  selectedTime === t.startTime
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-300 bg-white text-neutral-900 hover:border-neutral-500"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={!selectedTime || submitting}
            onClick={() => void submit()}
            className="mt-4 w-full rounded-lg bg-neutral-900 px-4 py-3 font-semibold text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "Moving…" : "Move my appointment"}
          </button>
        </div>
      )}
    </div>
  );
}
