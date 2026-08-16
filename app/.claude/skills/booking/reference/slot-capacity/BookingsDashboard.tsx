"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Staff bookings dashboard (slot-capacity variant). Installed by the Klaudius
 * booking skill as `src/app/admin/bookings/BookingsDashboard.tsx`.
 *
 * One day at a time: per-slot occupancy cards (with close/re-open), the day's
 * bookings with cancel + reason, and an "Add booking" form for phone callers
 * (admin session bypasses the online cutoff). Generic plumbing — keep the
 * neutral admin skin; translate owner-facing strings to the operator's
 * language if it isn't English.
 */

export interface DashboardConfig {
  businessName: string;
  locale: string;
  slotTimes: string[];
  maxCoversPerSlot: number;
  tablesPerSlot: number | null;
  minParty: number;
  maxParty: number;
  serviceDays: number[];
  todayStr: string;
}

interface BookingRow {
  id: string;
  booking_ref: string;
  booking_date: string;
  slot_time: string;
  party_size: number;
  tables_consumed: number | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  special_requests: string;
  visit_number: number | null;
  status: "confirmed" | "cancelled";
  cancellation_reason: string | null;
  cancelled_by: "customer" | "business" | null;
  created_at: string;
}

interface ClosureRow {
  id: string;
  closure_date: string;
  slot_time: string | null;
  reason: string;
}

const CANCEL_REASONS = [
  "Customer asked to cancel",
  "No-show",
  "Double booking",
  "Business closed that day",
];

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function timeLabel(timeStr: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`1970-01-01T${timeStr}:00Z`));
}

function dateLabel(dateStr: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${dateStr}T12:00:00Z`));
}

export default function BookingsDashboard({ cfg }: { cfg: DashboardConfig }) {
  const [date, setDate] = useState(cfg.todayStr);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [closures, setClosures] = useState<ClosureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);

  const [cancelTarget, setCancelTarget] = useState<BookingRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [add, setAdd] = useState({
    slotTime: cfg.slotTimes[0] ?? "",
    partySize: cfg.minParty,
    name: "",
    phone: "",
    email: "",
    specialRequests: "",
    sendConfirmationEmail: false,
  });

  // Monotonic sequence so a slow response for a previous date can never
  // overwrite the current date's view (rapid ←/→ clicking).
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      const [bRes, cRes] = await Promise.all([
        fetch(`/api/booking?date=${date}`),
        fetch(`/api/booking/admin/closures?from=${date}&to=${date}`),
      ]);
      const bJson = await bRes.json();
      const cJson = await cRes.json();
      if (bRes.status === 401 || cRes.status === 401) {
        throw new Error("Session expired — refresh the page and sign in again.");
      }
      if (!bRes.ok) throw new Error(bJson.error ?? "Failed to load bookings");
      if (!cRes.ok) throw new Error(cJson.error ?? "Failed to load closures");
      if (seq !== loadSeq.current) return; // a newer load superseded this one
      setBookings(bJson.bookings as BookingRow[]);
      setClosures(cJson.closures as ClosureRow[]);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmed = useMemo(() => bookings.filter((b) => b.status === "confirmed"), [bookings]);
  const cancelled = useMemo(() => bookings.filter((b) => b.status === "cancelled"), [bookings]);
  const isServiceDay = cfg.serviceDays.includes(new Date(`${date}T12:00:00Z`).getUTCDay());
  const dayClosure = closures.find((c) => c.slot_time === null);

  function slotStats(slot: string) {
    const rows = confirmed.filter((b) => b.slot_time === slot);
    const covers = rows.reduce((sum, b) => sum + b.party_size, 0);
    const tables = rows.reduce((sum, b) => sum + (b.tables_consumed ?? 0), 0);
    const closure = closures.find((c) => c.slot_time === slot) ?? dayClosure ?? null;
    return { covers, tables, count: rows.length, closure };
  }

  async function toggleClosure(slotTime: string | null, existing: ClosureRow | null) {
    setNotice(null);
    setError(null);
    try {
      const res = existing
        ? await fetch("/api/booking/admin/closures", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: existing.id }),
          })
        : await fetch("/api/booking/admin/closures", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date, slotTime }),
          });
      const json = await res.json();
      if (res.status === 401) throw new Error("Session expired — refresh the page and sign in again.");
      if (!res.ok) throw new Error(json.error ?? "Failed");
      const affected = slotTime === null ? confirmed.length : confirmed.filter((b) => b.slot_time === slotTime).length;
      setNotice(
        existing
          ? "Re-opened."
          : `Closed to new bookings.${affected > 0 ? ` ${affected} confirmed ${affected === 1 ? "booking remains" : "bookings remain"} — cancel them individually if needed.` : ""}`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function doCancel() {
    if (!cancelTarget) return;
    setCancelBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/booking/admin/${cancelTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", reason: cancelReason }),
      });
      const json = await res.json();
      if (res.status === 401) throw new Error("Session expired — refresh the page and sign in again.");
      if (!res.ok) throw new Error(json.error ?? "Failed to cancel");
      setNotice(
        json.alreadyCancelled
          ? `${cancelTarget.booking_ref} was already cancelled — no new email was sent.`
          : `Cancelled ${cancelTarget.booking_ref}. ${cancelTarget.customer_email ? "The customer has been emailed." : "No customer email on file — let them know if needed."}`
      );
      setCancelTarget(null);
      setCancelReason("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to cancel");
    } finally {
      setCancelBusy(false);
    }
  }

  async function doAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAddBusy(true);
    setError(null);
    setNotice(null);
    try {
      // website:"" keeps the request valid even if the admin session has
      // expired (the public branch requires the honeypot field present-and-empty).
      const res = await fetch("/api/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, ...add, website: "" }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json.details ? Object.values(json.details).flat().join(" ") : (json.error ?? "Failed to add booking")
        );
      }
      setNotice(`Added ${json.bookingRef} for ${add.name}.`);
      setShowAdd(false);
      setAdd({ ...add, name: "", phone: "", email: "", specialRequests: "", sendConfirmationEmail: false });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add booking");
    } finally {
      setAddBusy(false);
    }
  }

  const inputCls =
    "rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none";

  return (
    <main className="min-h-screen bg-[#F7F6F3] px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">Bookings</h1>
            <p className="text-sm text-neutral-500">{cfg.businessName}</p>
          </div>
          <a href="/admin" className="text-sm text-neutral-500 underline-offset-2 hover:underline">
            Site admin
          </a>
        </header>

        {/* Date navigation */}
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setDate(shiftDate(date, -1))} className={`${inputCls} bg-white`}>
            ←
          </button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={`${inputCls} bg-white`} />
          <button type="button" onClick={() => setDate(shiftDate(date, 1))} className={`${inputCls} bg-white`}>
            →
          </button>
          {date !== cfg.todayStr && (
            <button type="button" onClick={() => setDate(cfg.todayStr)} className={`${inputCls} bg-white font-semibold`}>
              Today
            </button>
          )}
          <span className="ml-1 text-sm font-semibold text-neutral-700">{dateLabel(date, cfg.locale)}</span>
          {!isServiceDay && <span className="rounded bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600">not a service day</span>}
        </div>

        {notice && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</div>}
        {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

        {/* Whole-day closure */}
        <div className="mb-5">
          <button
            type="button"
            onClick={() => toggleClosure(null, dayClosure ?? null)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${dayClosure ? "bg-neutral-900 text-white" : "border border-neutral-300 bg-white text-neutral-700"}`}
          >
            {dayClosure ? "Day closed — re-open" : "Close the whole day"}
          </button>
        </div>

        {/* Per-slot cards */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2">
          {cfg.slotTimes.map((slot) => {
            const st = slotStats(slot);
            const ownClosure = closures.find((c) => c.slot_time === slot) ?? null;
            return (
              <div key={slot} className="rounded-xl border border-neutral-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold text-neutral-900">{timeLabel(slot, cfg.locale)}</span>
                  {st.closure && <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">closed</span>}
                </div>
                <p className="mt-1 text-sm text-neutral-600">
                  {st.covers}/{cfg.maxCoversPerSlot} guests
                  {cfg.tablesPerSlot !== null && <> · {st.tables}/{cfg.tablesPerSlot} tables</>} · {st.count}{" "}
                  {st.count === 1 ? "booking" : "bookings"}
                </p>
                <button
                  type="button"
                  onClick={() => toggleClosure(slot, ownClosure)}
                  disabled={!!dayClosure}
                  className="mt-3 text-xs text-neutral-500 underline-offset-2 hover:underline disabled:opacity-40"
                >
                  {ownClosure ? "Re-open this time" : "Close this time"}
                </button>
              </div>
            );
          })}
        </div>

        {/* Add booking */}
        <div className="mb-8">
          <button
            type="button"
            onClick={() => setShowAdd(!showAdd)}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700"
          >
            {showAdd ? "Close" : "+ Add booking (phone)"}
          </button>
          {showAdd && (
            <form onSubmit={doAdd} className="mt-4 grid gap-3 rounded-xl border border-neutral-200 bg-white p-4 sm:grid-cols-2">
              <label className="text-sm text-neutral-700">
                Time
                <select value={add.slotTime} onChange={(e) => setAdd({ ...add, slotTime: e.target.value })} className={`${inputCls} mt-1 w-full`}>
                  {cfg.slotTimes.map((t) => (
                    <option key={t} value={t}>
                      {timeLabel(t, cfg.locale)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-neutral-700">
                Guests
                <select
                  value={add.partySize}
                  onChange={(e) => setAdd({ ...add, partySize: parseInt(e.target.value, 10) })}
                  className={`${inputCls} mt-1 w-full`}
                >
                  {Array.from({ length: cfg.maxParty - cfg.minParty + 1 }, (_, i) => cfg.minParty + i).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-neutral-700">
                Name
                <input required minLength={2} value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} className={`${inputCls} mt-1 w-full`} />
              </label>
              <label className="text-sm text-neutral-700">
                Phone <span className="text-neutral-400">(optional)</span>
                <input value={add.phone} onChange={(e) => setAdd({ ...add, phone: e.target.value })} className={`${inputCls} mt-1 w-full`} />
              </label>
              <label className="text-sm text-neutral-700 sm:col-span-2">
                Email <span className="text-neutral-400">(optional)</span>
                <input
                  type="email"
                  value={add.email}
                  onChange={(e) =>
                    setAdd({
                      ...add,
                      email: e.target.value,
                      // Clearing the email also unchecks the (now impossible) send option.
                      sendConfirmationEmail: e.target.value ? add.sendConfirmationEmail : false,
                    })
                  }
                  className={`${inputCls} mt-1 w-full`}
                />
              </label>
              <label className="text-sm text-neutral-700 sm:col-span-2">
                Notes <span className="text-neutral-400">(optional)</span>
                <input value={add.specialRequests} onChange={(e) => setAdd({ ...add, specialRequests: e.target.value })} className={`${inputCls} mt-1 w-full`} />
              </label>
              <label className="flex items-center gap-2 text-sm text-neutral-700 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={add.sendConfirmationEmail}
                  onChange={(e) => setAdd({ ...add, sendConfirmationEmail: e.target.checked })}
                  disabled={!add.email}
                />
                Send the customer a confirmation email
              </label>
              <div className="sm:col-span-2">
                <button type="submit" disabled={addBusy} className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-60">
                  {addBusy ? "Adding…" : "Add booking"}
                </button>
                <span className="ml-3 text-xs text-neutral-500">Phone bookings skip the online cutoff.</span>
              </div>
            </form>
          )}
        </div>

        {/* Bookings list */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold text-neutral-900">
              {confirmed.length} confirmed {confirmed.length === 1 ? "booking" : "bookings"}
            </h2>
            {cancelled.length > 0 && (
              <button type="button" onClick={() => setShowCancelled(!showCancelled)} className="text-xs text-neutral-500 underline-offset-2 hover:underline">
                {showCancelled ? "Hide" : "Show"} {cancelled.length} cancelled
              </button>
            )}
          </div>

          {loading ? (
            <p className="text-sm text-neutral-500">Loading…</p>
          ) : confirmed.length === 0 && (!showCancelled || cancelled.length === 0) ? (
            <p className="rounded-xl border border-dashed border-neutral-300 bg-white px-4 py-8 text-center text-sm text-neutral-500">
              No bookings for this day.
            </p>
          ) : (
            <ul className="space-y-3">
              {[...confirmed, ...(showCancelled ? cancelled : [])].map((b) => (
                <li key={b.id} className={`rounded-xl border bg-white p-4 ${b.status === "cancelled" ? "border-neutral-200 opacity-60" : "border-neutral-200"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <span className="font-bold text-neutral-900">{timeLabel(b.slot_time, cfg.locale)}</span>
                      <span className="ml-2 font-semibold text-neutral-800">{b.customer_name}</span>
                      {b.visit_number != null && (
                        <span
                          className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${b.visit_number <= 1 ? "bg-sky-100 text-sky-800" : "bg-emerald-100 text-emerald-800"}`}
                        >
                          {b.visit_number <= 1 ? "New" : `Booking #${b.visit_number}`}
                        </span>
                      )}
                      <span className="ml-2 text-sm text-neutral-500">
                        {b.party_size} {b.party_size === 1 ? "guest" : "guests"} · {b.booking_ref}
                      </span>
                      {b.status === "cancelled" && (
                        <span className="ml-2 rounded bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600">
                          cancelled{b.cancelled_by === "customer" ? " by customer" : ""}
                        </span>
                      )}
                    </div>
                    {b.status === "confirmed" && (
                      <button
                        type="button"
                        onClick={() => {
                          setCancelTarget(b);
                          setCancelReason("");
                        }}
                        className="text-sm text-red-600 underline-offset-2 hover:underline"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-neutral-600">
                    {b.customer_phone && (
                      <a href={`tel:${b.customer_phone.replace(/\s+/g, "")}`} className="mr-3 underline-offset-2 hover:underline">
                        {b.customer_phone}
                      </a>
                    )}
                    {b.customer_email && (
                      <a href={`mailto:${b.customer_email}`} className="underline-offset-2 hover:underline">
                        {b.customer_email}
                      </a>
                    )}
                  </div>
                  {b.special_requests && <p className="mt-1 text-sm italic text-neutral-600">"{b.special_requests}"</p>}
                  {b.cancellation_reason && <p className="mt-1 text-xs text-neutral-500">Reason: {b.cancellation_reason}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Cancel modal */}
        {cancelTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-5">
            <div className="w-full max-w-md rounded-xl bg-white p-6">
              <h3 className="text-lg font-bold text-neutral-900">Cancel this booking?</h3>
              <p className="mt-1 text-sm text-neutral-600">
                {cancelTarget.booking_ref} — {cancelTarget.customer_name},{" "}
                {timeLabel(cancelTarget.slot_time, cfg.locale)}, {cancelTarget.party_size}{" "}
                {cancelTarget.party_size === 1 ? "guest" : "guests"}.
                {cancelTarget.customer_email ? " The customer will be emailed." : " No customer email on file."}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {CANCEL_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setCancelReason(r)}
                    className={`rounded-md border px-2.5 py-1 text-xs ${cancelReason === r ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700"}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <input
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Reason (optional)"
                className={`${inputCls} mt-3 w-full`}
              />
              {error && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {error}
                </div>
              )}
              <div className="mt-5 flex justify-end gap-3">
                <button type="button" onClick={() => setCancelTarget(null)} className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700">
                  Keep booking
                </button>
                <button type="button" onClick={doCancel} disabled={cancelBusy} className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                  {cancelBusy ? "Cancelling…" : "Cancel booking"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
