import {
  buildIcsEvent,
  ctaButton,
  detailRow,
  detailsTable,
  emailShell,
  escapeHtml,
  refBadge,
  sendMail,
} from "./email";
import { formatLongDate, formatTimeLabel } from "./dates";
import type { BookingSettings } from "./settings";

/**
 * The seven booking emails (appointments variant). Installed by the Klaudius
 * booking skill as `src/lib/booking/emails.ts`.
 *
 * Copy zones: the ACCENT colour and the wording carrying generate markers
 * below are per-site (brand-match the colour; adapt "appointment" to the
 * business's own word and translate every string to the operator's language
 * if it isn't English). The structure and the Reply-To routing are proven
 * plumbing — keep them.
 *
 * Reply-To routing (the From address is send-only and can't receive):
 *   - customer-facing mail: Reply-To = the owner's real inbox
 *   - owner-facing mail:    Reply-To = the customer
 */

// booking-generate: set to the site's primary brand colour.
const ACCENT = "#44554E";

export interface EmailAppointment {
  bookingRef: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  /** HH:MM — enables the calendar attachment; omit where unknown. */
  endTime?: string;
  serviceName: string;
  staffName: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  notes: string;
}

function footer(s: BookingSettings): string {
  return [s.businessName, s.businessAddress, s.businessPhone]
    .filter(Boolean)
    .join(" · ");
}

/** Calendar attachment for customer-facing mail. Floating local time (see buildIcsEvent). */
function icsFor(s: BookingSettings, a: EmailAppointment) {
  if (!a.endTime) return undefined;
  return buildIcsEvent({
    uid: `${a.bookingRef}@${s.businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "booking"}`,
    date: a.date,
    startTime: a.startTime,
    endTime: a.endTime,
    summary: `${a.serviceName} — ${s.businessName}`,
    description: `Booking reference: ${a.bookingRef}${a.staffName ? `\nWith ${a.staffName}` : ""}`,
    location: s.businessAddress,
    organizer: { name: s.businessName, email: s.businessEmail },
  });
}

function coreRows(s: BookingSettings, a: EmailAppointment): string[] {
  return [
    detailRow("Date", escapeHtml(formatLongDate(a.date, s.locale))),
    detailRow("Time", escapeHtml(formatTimeLabel(a.startTime, s.locale))),
    detailRow("Service", escapeHtml(a.serviceName)),
    detailRow("With", escapeHtml(a.staffName)),
  ];
}

// ─── Customer confirmation ──────────────────────────────────────────────────

export async function sendCustomerConfirmation(
  s: BookingSettings,
  a: EmailAppointment,
  cancelUrl: string
): Promise<void> {
  const longDate = formatLongDate(a.date, s.locale);
  const timeLabel = formatTimeLabel(a.startTime, s.locale);

  const policyBox = `
    <div style="margin:24px 0;padding:14px 16px;background:#FFFBEA;border-left:3px solid #E1B85E;border-radius:6px;color:#5b4a1c">
      <strong>Plans change?</strong> You can pick a new time or cancel online using
      the link below — up to <strong>${s.cutoffHours} hours before your appointment</strong>.
      After that, please call us${s.businessPhone ? ` on <a href="tel:${escapeHtml(s.businessPhone.replace(/\s+/g, ""))}" style="color:#5b4a1c;font-weight:bold">${escapeHtml(s.businessPhone)}</a>` : ""} if you can't make it.
    </div>`;

  const html = emailShell({
    accent: ACCENT,
    heading: "Your appointment is confirmed", // booking-generate: business-type wording
    intro: `Thank you for booking with ${s.businessName}. We look forward to seeing you.`,
    bodyHtml: [
      refBadge("Booking reference", a.bookingRef, ACCENT),
      detailsTable(coreRows(s, a)),
      a.notes
        ? `<p style="margin-top:14px;color:#666">Notes: <em>${escapeHtml(a.notes)}</em></p>`
        : "",
      policyBox,
      ctaButton("Change or cancel my appointment", cancelUrl, ACCENT),
      a.endTime
        ? `<p style="text-align:center;color:#999;font-size:12px">A calendar invite is attached.</p>`
        : "",
    ].join(""),
    footerText: footer(s),
  });

  const text = [
    `Your appointment is confirmed — ${s.businessName}`,
    `Ref: ${a.bookingRef}`,
    `${longDate}, ${timeLabel}`,
    `${a.serviceName} with ${a.staffName}`,
    a.notes ? `Notes: ${a.notes}` : null,
    "",
    `Plans change? Pick a new time or cancel online up to ${s.cutoffHours} hours before your appointment:`,
    cancelUrl,
    s.businessPhone ? `After that, please call ${s.businessPhone}.` : null,
  ]
    .filter((l) => l !== null)
    .join("\n");

  await sendMail({
    to: a.customerEmail,
    fromName: s.businessName,
    replyTo: s.businessEmail,
    subject: `Your ${s.businessName} appointment — ${longDate}, ${timeLabel}`,
    html,
    text,
    icalEvent: icsFor(s, a),
  });
}

// ─── Owner notification ─────────────────────────────────────────────────────

export async function sendOwnerNotification(
  s: BookingSettings,
  a: EmailAppointment,
  visitNumber?: number | null
): Promise<void> {
  const safeName = a.customerName.replace(/[\r\n]+/g, " ").slice(0, 80);
  const longDate = formatLongDate(a.date, s.locale);
  const timeLabel = formatTimeLabel(a.startTime, s.locale);
  const phoneHref = a.customerPhone.replace(/\s+/g, "");
  const historyLabel =
    visitNumber == null ? null : visitNumber <= 1 ? "First-time customer" : `Returning customer — booking #${visitNumber}`;

  const rows = [
    ...coreRows(s, a),
    detailRow("Name", escapeHtml(a.customerName)),
    detailRow(
      "Phone",
      a.customerPhone
        ? `<a href="tel:${escapeHtml(phoneHref)}" style="color:${ACCENT}">${escapeHtml(a.customerPhone)}</a>`
        : "—"
    ),
    detailRow(
      "Email",
      a.customerEmail
        ? `<a href="mailto:${escapeHtml(a.customerEmail)}" style="color:${ACCENT}">${escapeHtml(a.customerEmail)}</a>`
        : "—"
    ),
  ];
  if (historyLabel) rows.push(detailRow("History", escapeHtml(historyLabel)));
  if (a.notes) rows.push(detailRow("Notes", `<em>${escapeHtml(a.notes)}</em>`));

  const html = emailShell({
    accent: ACCENT,
    heading: "New appointment",
    intro: `Ref: ${a.bookingRef}`,
    bodyHtml: detailsTable(rows),
    footerText: footer(s),
  });

  const text = [
    `New appointment: ${a.bookingRef}`,
    `${a.customerName} — ${longDate}, ${timeLabel}`,
    `${a.serviceName} with ${a.staffName}`,
    a.customerPhone ? `Phone: ${a.customerPhone}` : null,
    a.customerEmail ? `Email: ${a.customerEmail}` : null,
    historyLabel ? `History: ${historyLabel}` : null,
    a.notes ? `Notes: ${a.notes}` : null,
  ]
    .filter((l) => l !== null)
    .join("\n");

  await sendMail({
    to: s.businessEmail,
    fromName: `${s.businessName} Bookings`,
    replyTo: a.customerEmail.trim() || undefined,
    subject: `New appointment: ${safeName} — ${longDate}, ${timeLabel} (${a.serviceName})`,
    html,
    text,
  });
}

// ─── Day-of reminder ────────────────────────────────────────────────────────

export async function sendCustomerReminder(
  s: BookingSettings,
  a: EmailAppointment
): Promise<void> {
  const longDate = formatLongDate(a.date, s.locale);
  const timeLabel = formatTimeLabel(a.startTime, s.locale);

  const html = emailShell({
    accent: ACCENT,
    heading: "See you today",
    intro: `A quick reminder of your appointment with ${s.businessName} today.`,
    bodyHtml: [
      detailsTable([...coreRows(s, a), detailRow("Reference", escapeHtml(a.bookingRef))]),
      s.businessAddress
        ? `<p style="margin-top:18px;color:#666;font-size:14px">Address: ${escapeHtml(s.businessAddress)}</p>`
        : "",
      `<p style="margin-top:18px;color:#999;font-size:12px;font-style:italic;text-align:center">
        Online cancellation has now closed. If you can't make it, please call us${s.businessPhone ? ` on ${escapeHtml(s.businessPhone)}` : ""} so we can offer your time to someone else.
      </p>`,
    ].join(""),
    footerText: footer(s),
  });

  const text = [
    `See you today at ${s.businessName}`,
    `${longDate}, ${timeLabel}`,
    `${a.serviceName} with ${a.staffName}`,
    `Ref: ${a.bookingRef}`,
    s.businessAddress ? `Address: ${s.businessAddress}` : null,
    "",
    `(Online cancellation has closed. ${s.businessPhone ? `Please call ${s.businessPhone} if you can't make it.` : "Please contact us if you can't make it."})`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  await sendMail({
    to: a.customerEmail,
    fromName: s.businessName,
    replyTo: s.businessEmail,
    subject: `Today: your ${s.businessName} appointment at ${timeLabel}`,
    html,
    text,
    icalEvent: icsFor(s, a),
  });
}

// ─── Reschedule emails — both directions ────────────────────────────────────

export async function sendCustomerReschedule(
  s: BookingSettings,
  a: EmailAppointment,
  oldDate: string,
  oldStartTime: string,
  cancelUrl: string
): Promise<void> {
  const longDate = formatLongDate(a.date, s.locale);
  const timeLabel = formatTimeLabel(a.startTime, s.locale);
  const oldLabel = `${formatLongDate(oldDate, s.locale)}, ${formatTimeLabel(oldStartTime, s.locale)}`;

  const html = emailShell({
    accent: ACCENT,
    heading: "Your appointment has been moved", // booking-generate: business-type wording
    intro: `Your appointment with ${s.businessName} has a new time. Here are the updated details.`,
    bodyHtml: [
      refBadge("New booking reference", a.bookingRef, ACCENT),
      detailsTable(coreRows(s, a)),
      `<p style="margin-top:14px;color:#666">Previously: <s>${escapeHtml(oldLabel)}</s></p>`,
      ctaButton("Change or cancel my appointment", cancelUrl, ACCENT),
      a.endTime
        ? `<p style="text-align:center;color:#999;font-size:12px">An updated calendar invite is attached — if you added the old time to your calendar, please remove it.</p>`
        : "",
    ].join(""),
    footerText: footer(s),
  });

  const text = [
    `Your ${s.businessName} appointment has been moved`,
    `New ref: ${a.bookingRef}`,
    `Now: ${longDate}, ${timeLabel}`,
    `${a.serviceName} with ${a.staffName}`,
    `Previously: ${oldLabel}`,
    "",
    `Change or cancel online (up to ${s.cutoffHours} hours before):`,
    cancelUrl,
  ].join("\n");

  await sendMail({
    to: a.customerEmail,
    fromName: s.businessName,
    replyTo: s.businessEmail,
    subject: `Appointment moved — now ${longDate}, ${timeLabel}`,
    html,
    text,
    icalEvent: icsFor(s, a),
  });
}

export async function sendOwnerReschedule(
  s: BookingSettings,
  a: EmailAppointment,
  oldDate: string,
  oldStartTime: string,
  visitNumber?: number | null
): Promise<void> {
  const safeName = a.customerName.replace(/[\r\n]+/g, " ").slice(0, 80);
  const longDate = formatLongDate(a.date, s.locale);
  const timeLabel = formatTimeLabel(a.startTime, s.locale);
  const oldLabel = `${formatLongDate(oldDate, s.locale)}, ${formatTimeLabel(oldStartTime, s.locale)}`;
  const historyLabel =
    visitNumber == null ? null : visitNumber <= 1 ? "First-time customer" : `Returning customer — booking #${visitNumber}`;

  const rows = [
    ...coreRows(s, a),
    detailRow("Previously", escapeHtml(oldLabel)),
    detailRow(
      "Customer",
      `${escapeHtml(a.customerName)}${a.customerPhone ? ` · ${escapeHtml(a.customerPhone)}` : ""}${a.customerEmail ? ` · ${escapeHtml(a.customerEmail)}` : ""}`
    ),
  ];
  if (historyLabel) rows.push(detailRow("History", escapeHtml(historyLabel)));

  const html = emailShell({
    accent: ACCENT,
    heading: "Appointment rescheduled by customer",
    intro: `New ref: ${a.bookingRef}`,
    bodyHtml: [
      detailsTable(rows),
      `<p style="color:#666">The old time has been freed up in the calendar.</p>`,
    ].join(""),
    footerText: footer(s),
  });

  const text = [
    `Appointment rescheduled: ${a.bookingRef}`,
    `${a.customerName} — now ${longDate}, ${timeLabel}`,
    `${a.serviceName} with ${a.staffName}`,
    `Previously: ${oldLabel}`,
    a.customerPhone ? `Phone: ${a.customerPhone}` : null,
    a.customerEmail ? `Email: ${a.customerEmail}` : null,
    historyLabel ? `History: ${historyLabel}` : null,
  ]
    .filter((l) => l !== null)
    .join("\n");

  await sendMail({
    to: s.businessEmail,
    fromName: `${s.businessName} Bookings`,
    replyTo: a.customerEmail.trim() || undefined,
    subject: `Rescheduled: ${safeName} — now ${longDate}, ${timeLabel}`,
    html,
    text,
  });
}

// ─── Cancellation emails — both directions ──────────────────────────────────

export async function sendCustomerCancellation(
  s: BookingSettings,
  a: EmailAppointment,
  cancelledBy: "customer" | "business"
): Promise<void> {
  const longDate = formatLongDate(a.date, s.locale);
  const timeLabel = formatTimeLabel(a.startTime, s.locale);
  const callLink = s.businessPhone
    ? ` or call us on <a href="tel:${escapeHtml(s.businessPhone.replace(/\s+/g, ""))}" style="color:${ACCENT};font-weight:bold">${escapeHtml(s.businessPhone)}</a>`
    : "";

  const intro =
    cancelledBy === "business"
      ? `We're sorry — we've had to cancel your appointment with us. If you'd like to rebook${callLink ? `, book online${callLink}` : ", you can book online any time"}.`
      : `Your appointment has been cancelled. If this was a mistake, you can book again any time${callLink}.`;

  const html = emailShell({
    accent: "#b13a3a",
    heading: "Appointment cancelled",
    bodyHtml: [
      `<p style="color:#666">${intro}</p>`,
      refBadge("Reference", a.bookingRef, ACCENT),
      detailsTable(coreRows(s, a)),
    ].join(""),
    footerText: footer(s),
  });

  const text = [
    cancelledBy === "business"
      ? `Your ${s.businessName} appointment has been cancelled by the business.`
      : `Your ${s.businessName} appointment has been cancelled.`,
    `Ref: ${a.bookingRef}`,
    `${longDate}, ${timeLabel}`,
    `${a.serviceName} with ${a.staffName}`,
    "",
    cancelledBy === "business"
      ? `We're sorry for any inconvenience.${s.businessPhone ? ` To rebook or for any questions, call us on ${s.businessPhone}.` : ""}`
      : `If this was a mistake, you can book again any time.${s.businessPhone ? ` Questions? Call ${s.businessPhone}.` : ""}`,
  ].join("\n");

  await sendMail({
    to: a.customerEmail,
    fromName: s.businessName,
    replyTo: s.businessEmail,
    subject:
      cancelledBy === "business"
        ? `Your ${s.businessName} appointment has been cancelled`
        : `Your ${s.businessName} appointment is cancelled`,
    html,
    text,
  });
}

export async function sendOwnerCancellation(
  s: BookingSettings,
  a: EmailAppointment,
  cancelledBy: "customer" | "business",
  reason?: string
): Promise<void> {
  const longDate = formatLongDate(a.date, s.locale);
  const timeLabel = formatTimeLabel(a.startTime, s.locale);
  // The owner gets this even for their own dashboard cancels — it's their
  // written record that the cancel went through.
  const heading =
    cancelledBy === "business"
      ? "Appointment cancelled from the dashboard"
      : "Appointment cancelled by customer";
  const trimmedReason = reason?.trim() || "";

  const rows = [
    ...coreRows(s, a),
    detailRow(
      "Customer",
      `${escapeHtml(a.customerName)}${a.customerPhone ? ` · ${escapeHtml(a.customerPhone)}` : ""}${a.customerEmail ? ` · ${escapeHtml(a.customerEmail)}` : ""}`
    ),
  ];
  if (trimmedReason) rows.push(detailRow("Reason", escapeHtml(trimmedReason)));

  const html = emailShell({
    accent: "#b13a3a",
    heading,
    intro: `Ref: ${a.bookingRef}`,
    bodyHtml: [
      detailsTable(rows),
      `<p style="color:#666">The time has been freed up in the calendar.</p>`,
    ].join(""),
    footerText: footer(s),
  });

  const text = [
    `${heading}: ${a.bookingRef}`,
    `${a.customerName} — ${longDate}, ${timeLabel}`,
    `${a.serviceName} with ${a.staffName}`,
    a.customerPhone ? `Phone: ${a.customerPhone}` : null,
    a.customerEmail ? `Email: ${a.customerEmail}` : null,
    trimmedReason ? `Reason: ${trimmedReason}` : null,
  ]
    .filter((l) => l !== null)
    .join("\n");

  await sendMail({
    to: s.businessEmail,
    fromName: `${s.businessName} Bookings`,
    replyTo: a.customerEmail.trim() || undefined,
    subject:
      cancelledBy === "business"
        ? `Cancelled (dashboard): ${a.customerName} — ${longDate}, ${timeLabel}`
        : `Cancellation: ${a.customerName} — ${longDate}, ${timeLabel}`,
    html,
    text,
  });
}
