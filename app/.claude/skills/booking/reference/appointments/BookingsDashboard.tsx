"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Staff bookings dashboard (appointments variant). Installed by the Klaudius
 * booking skill as `src/app/admin/bookings/BookingsDashboard.tsx`.
 *
 * One day at a time: a column per staff member with their appointments,
 * cancel with reason, an "Add appointment" form for walk-ins/phone callers
 * (admin session bypasses the online cutoff and grid alignment), and
 * closures for the whole business or a single staff member. Generic
 * plumbing — keep the neutral admin skin; translate owner-facing strings to
 * the operator's language if it isn't English.
 */

export interface DashboardConfig {
  businessName: string;
  locale: string;
  services: { id: string; name: string; durationMinutes: number }[];
  staff: { id: string; name: string }[];
  todayStr: string;
}

interface ApptRow {
  id: string;
  booking_ref: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  notes: string;
  visit_number: number | null;
  status: "confirmed" | "cancelled";
  cancellation_reason: string | null;
  cancelled_by: "customer" | "business" | null;
  service: { name: string } | null;
  staff: { id: string; name: string } | null;
}

interface ClosureRow {
  id: string;
  closure_date: string;
  staff_id: string | null;
  reason: string;
}

const CANCEL_REASONS = [
  "Customer asked to cancel",
  "No-show",
  "Double booking",
  "Staff unavailable",
];

// Top-level (not defined inside the dashboard component) so React keeps the
// card DOM across re-renders instead of remounting every card on each state
// change.
function ApptCard({
  a,
  locale,
  onCancel,
}: {
  a: ApptRow;
  locale: string;
  onCancel: (a: ApptRow) => void;
}) {
  return (
    <li className={`rounded-lg border bg-white p-3 ${a.status === "cancelled" ? "border-neutral-200 opacity-60" : "border-neutral-200"}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="font-bold text-neutral-900">{timeLabel(a.start_time, locale)}</span>
          <span className="ml-1 text-xs text-neutral-500">– {timeLabel(a.end_time, locale)}</span>
          {a.status === "cancelled" && (
            <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-600">
              cancelled{a.cancelled_by === "customer" ? " by customer" : ""}
            </span>
          )}
        </div>
        {a.status === "confirmed" && (
          <button
            type="button"
            onClick={() => onCancel(a)}
            className="text-xs text-red-600 underline-offset-2 hover:underline"
          >
            Cancel
          </button>
        )}
      </div>
      <p className="mt-0.5 text-sm font-semibold text-neutral-800">
        {a.customer_name}
        {a.visit_number != null && (
          <span
            className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${a.visit_number <= 1 ? "bg-sky-100 text-sky-800" : "bg-emerald-100 text-emerald-800"}`}
          >
            {a.visit_number <= 1 ? "New" : `Booking #${a.visit_number}`}
          </span>
        )}
      </p>
      <p className="text-xs text-neutral-600">
        {a.service?.name ?? ""} · {a.booking_ref}
      </p>
      <p className="mt-0.5 text-xs text-neutral-500">
        {a.customer_phone && (
          <a href={`tel:${a.customer_phone.replace(/\s+/g, "")}`} className="mr-2 underline-offset-2 hover:underline">
            {a.customer_phone}
          </a>
        )}
        {a.customer_email && (
          <a href={`mailto:${a.customer_email}`} className="underline-offset-2 hover:underline">
            {a.customer_email}
          </a>
        )}
      </p>
      {a.notes && <p className="mt-1 text-xs italic text-neutral-600">"{a.notes}"</p>}
      {a.cancellation_reason && <p className="mt-1 text-[10px] text-neutral-500">Reason: {a.cancellation_reason}</p>}
    </li>
  );
}

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
  }).format(new Date(`1970-01-01T${timeStr.slice(0, 5)}:00Z`));
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
  const [appts, setAppts] = useState<ApptRow[]>([]);
  const [closures, setClosures] = useState<ClosureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);

  const [cancelTarget, setCancelTarget] = useState<ApptRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [add, setAdd] = useState({
    serviceId: cfg.services[0]?.id ?? "",
    staffId: "" as string, // "" = any
    startTime: "10:00",
    name: "",
    phone: "",
    email: "",
    notes: "",
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
      const [aRes, cRes] = await Promise.all([
        fetch(`/api/booking?date=${date}`),
        fetch(`/api/booking/admin/closures?from=${date}&to=${date}`),
      ]);
      const aJson = await aRes.json();
      const cJson = await cRes.json();
      if (aRes.status === 401 || cRes.status === 401) {
        throw new Error("Session expired — refresh the page and sign in again.");
      }
      if (!aRes.ok) throw new Error(aJson.error ?? "Failed to load appointments");
      if (!cRes.ok) throw new Error(cJson.error ?? "Failed to load closures");
      if (seq !== loadSeq.current) return; // a newer load superseded this one
      setAppts(aJson.appointments as ApptRow[]);
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

  const confirmed = useMemo(() => appts.filter((a) => a.status === "confirmed"), [appts]);
  const cancelled = useMemo(() => appts.filter((a) => a.status === "cancelled"), [appts]);
  const dayClosure = closures.find((c) => c.staff_id === null);

  // Columns = the active staff catalogue PLUS anyone who still has
  // appointments today but was since deactivated — otherwise those
  // appointments would render in no column and the day would look free.
  const staffColumns = useMemo(() => {
    const cols = new Map(cfg.staff.map((st) => [st.id, { ...st, inactive: false }]));
    for (const a of appts) {
      if (a.staff && !cols.has(a.staff.id)) {
        cols.set(a.staff.id, { id: a.staff.id, name: `${a.staff.name} (inactive)`, inactive: true });
      }
    }
    return [...cols.values()];
  }, [cfg.staff, appts]);

  async function toggleClosure(staffId: string | null, existing: ClosureRow | null) {
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
            body: JSON.stringify({ date, staffId }),
          });
      const json = await res.json();
      if (res.status === 401) throw new Error("Session expired — refresh the page and sign in again.");
      if (!res.ok) throw new Error(json.error ?? "Failed");
      const affected =
        staffId === null ? confirmed.length : confirmed.filter((a) => a.staff?.id === staffId).length;
      setNotice(
        existing
          ? "Re-opened."
          : `Closed to new bookings.${affected > 0 ? ` ${affected} confirmed ${affected === 1 ? "appointment remains" : "appointments remain"} — cancel them individually if needed.` : ""}`
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
        body: JSON.stringify({
          date,
          startTime: add.startTime,
          serviceId: add.serviceId,
          staffId: add.staffId || null,
          name: add.name,
          phone: add.phone,
          email: add.email,
          notes: add.notes,
          sendConfirmationEmail: add.sendConfirmationEmail,
          website: "",
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json.details ? Object.values(json.details).flat().join(" ") : (json.error ?? "Failed to add appointment")
        );
      }
      setNotice(`Added ${json.bookingRef} for ${add.name}${json.booking?.staffName ? ` with ${json.booking.staffName}` : ""}.`);
      setShowAdd(false);
      setAdd({ ...add, name: "", phone: "", email: "", notes: "", sendConfirmationEmail: false });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add appointment");
    } finally {
      setAddBusy(false);
    }
  }

  const inputCls =
    "rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none";

  return (
    <main className="min-h-screen bg-[#F7F6F3] px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-5xl">
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
        </div>

        {notice && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</div>}
        {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

        {/* Closures + add */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => toggleClosure(null, dayClosure ?? null)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${dayClosure ? "bg-neutral-900 text-white" : "border border-neutral-300 bg-white text-neutral-700"}`}
          >
            {dayClosure ? "Day closed — re-open" : "Close the whole day"}
          </button>
          <button
            type="button"
            onClick={() => setShowAdd(!showAdd)}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-neutral-700"
          >
            {showAdd ? "Close" : "+ Add appointment"}
          </button>
          {cancelled.length > 0 && (
            <button type="button" onClick={() => setShowCancelled(!showCancelled)} className="text-xs text-neutral-500 underline-offset-2 hover:underline">
              {showCancelled ? "Hide" : "Show"} {cancelled.length} cancelled
            </button>
          )}
        </div>

        {showAdd && (
          <form onSubmit={doAdd} className="mb-6 grid gap-3 rounded-xl border border-neutral-200 bg-white p-4 sm:grid-cols-2">
            <label className="text-sm text-neutral-700">
              Service
              <select value={add.serviceId} onChange={(e) => setAdd({ ...add, serviceId: e.target.value })} className={`${inputCls} mt-1 w-full`}>
                {cfg.services.map((sv) => (
                  <option key={sv.id} value={sv.id}>
                    {sv.name} ({sv.durationMinutes} min)
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-neutral-700">
              With
              <select value={add.staffId} onChange={(e) => setAdd({ ...add, staffId: e.target.value })} className={`${inputCls} mt-1 w-full`}>
                <option value="">Anyone available</option>
                {cfg.staff.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-neutral-700">
              Start time
              <input
                type="time"
                required
                value={add.startTime}
                onChange={(e) => setAdd({ ...add, startTime: e.target.value })}
                className={`${inputCls} mt-1 w-full`}
              />
            </label>
            <label className="text-sm text-neutral-700">
              Name
              <input required minLength={2} value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} className={`${inputCls} mt-1 w-full`} />
            </label>
            <label className="text-sm text-neutral-700">
              Phone <span className="text-neutral-400">(optional)</span>
              <input value={add.phone} onChange={(e) => setAdd({ ...add, phone: e.target.value })} className={`${inputCls} mt-1 w-full`} />
            </label>
            <label className="text-sm text-neutral-700">
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
              <input value={add.notes} onChange={(e) => setAdd({ ...add, notes: e.target.value })} className={`${inputCls} mt-1 w-full`} />
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
                {addBusy ? "Adding…" : "Add appointment"}
              </button>
              <span className="ml-3 text-xs text-neutral-500">Front-desk bookings skip the online cutoff and can use odd times.</span>
            </div>
          </form>
        )}

        {/* Per-staff columns */}
        {loading ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : staffColumns.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-300 bg-white px-4 py-8 text-center text-sm text-neutral-500">
            No active staff configured — add staff in the booking settings.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {staffColumns.map((st) => {
              const staffClosure = closures.find((c) => c.staff_id === st.id) ?? null;
              const rows = [...confirmed, ...(showCancelled ? cancelled : [])]
                .filter((a) => a.staff?.id === st.id)
                .sort((a, b) => a.start_time.localeCompare(b.start_time));
              return (
                <section key={st.id} className="rounded-xl border border-neutral-200 bg-white p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="font-bold text-neutral-900">{st.name}</h2>
                    <div className="flex items-center gap-2">
                      {(staffClosure || dayClosure) && (
                        <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                          {dayClosure ? "closed" : "off today"}
                        </span>
                      )}
                      {!st.inactive && (
                        <button
                          type="button"
                          onClick={() => toggleClosure(st.id, staffClosure)}
                          disabled={!!dayClosure}
                          className="text-xs text-neutral-500 underline-offset-2 hover:underline disabled:opacity-40"
                        >
                          {staffClosure ? "Mark available" : "Mark off"}
                        </button>
                      )}
                    </div>
                  </div>
                  {rows.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-neutral-300 px-3 py-6 text-center text-xs text-neutral-500">
                      No appointments.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {rows.map((a) => (
                        <ApptCard
                          key={a.id}
                          a={a}
                          locale={cfg.locale}
                          onCancel={(appt) => {
                            setCancelTarget(appt);
                            setCancelReason("");
                          }}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}

        {/* Cancel modal */}
        {cancelTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-5">
            <div className="w-full max-w-md rounded-xl bg-white p-6">
              <h3 className="text-lg font-bold text-neutral-900">Cancel this appointment?</h3>
              <p className="mt-1 text-sm text-neutral-600">
                {cancelTarget.booking_ref} — {cancelTarget.customer_name},{" "}
                {timeLabel(cancelTarget.start_time, cfg.locale)}
                {cancelTarget.service?.name ? `, ${cancelTarget.service.name}` : ""}.
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
                  Keep appointment
                </button>
                <button type="button" onClick={doCancel} disabled={cancelBusy} className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                  {cancelBusy ? "Cancelling…" : "Cancel appointment"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
