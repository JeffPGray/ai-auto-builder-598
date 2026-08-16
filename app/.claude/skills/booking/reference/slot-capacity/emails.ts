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
import { addMinutesToTime, formatLongDate, formatTimeLabel } from "./dates";
import type { BookingSettings } from "./settings";

/**
 * The seven booking emails (slot-capacity variant). Installed by the Klaudius
 * booking skill as `src/lib/booking/emails.ts`.
 *
 * Copy zones: the ACCENT colour and the wording carrying generate markers
 * below are per-site (brand-match the colour; adapt "booking" to the
 * business's own word — "table", "seat", "place" — and translate every
 * customer/owner-facing string to the operator's language if it isn't
 * English). The structure and the Reply-To routing are proven plumbing —
 * keep them.
 *
 * Reply-To routing (the From address is send-only and can't receive):
 *   - customer-facing mail: Reply-To = the owner's real inbox
 *   - owner-facing mail:    Reply-To = the customer (owner can hit Reply to
 *     confirm a request or ask about a cancellation)
 */

// booking-generate: set to the site's primary brand colour (dark enough to
// read as text on white).
const ACCENT = "#44554E";

export interface EmailBooking {
  bookingRef: string;
  date: string; // YYYY-MM-DD
  slotTime: string; // HH:MM
  partySize: number;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  specialRequests: string;
}

function guestsLabel(n: number): string {
  return `${n} ${n === 1 ? "guest" : "guests"}`;
}

function footer(s: BookingSettings): string {
  return [s.businessName, s.businessAddress, s.businessPhone]
    .filter(Boolean)
    .join(" · ");
}

function coreRows(s: BookingSettings, b: EmailBooking): string[] {
  return [
    detailRow("Date", escapeHtml(formatLongDate(b.date, s.locale))),
    detailRow("Time", escapeHtml(formatTimeLabel(b.slotTime, s.locale))),
    detailRow("Party size", escapeHtml(guestsLabel(b.partySize))),
  ];
}

/** Calendar attachment for customer-facing mail. Floating local time (see buildIcsEvent). */
function icsFor(s: BookingSettings, b: EmailBooking) {
  return buildIcsEvent({
    uid: `${b.bookingRef}@${s.businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "booking"}`,
    date: b.date,
    startTime: b.slotTime,
    endTime: addMinutesToTime(b.slotTime, s.slotDurationMinutes),
    summary: `${s.businessName} — ${guestsLabel(b.partySize)}`,
    description: `Booking reference: ${b.bookingRef}`,
    location: s.businessAddress,
    organizer: { name: s.businessName, email: s.businessEmail },
    filename: "booking.ics",
  });
}

// ─── Customer confirmation — sent immediately after booking ─────────────────

export async function sendCustomerConfirmation(
  s: BookingSettings,
  b: EmailBooking,
  cancelUrl: string
): Promise<void> {
  const longDate = formatLongDate(b.date, s.locale);
  const timeLabel = formatTimeLabel(b.slotTime, s.locale);

  const policyBox = `
    <div style="margin:24px 0;padding:14px 16px;background:#FFFBEA;border-left:3px solid #E1B85E;border-radius:6px;color:#5b4a1c">
      <strong>Plans change?</strong> You can pick a new time or cancel online using
      the link below — up to <strong>${s.cutoffHours} hours before your booking</strong>.
      After that, please call us${s.businessPhone ? ` on <a href="tel:${escapeHtml(s.businessPhone.replace(/\s+/g, ""))}" style="color:#5b4a1c;font-weight:bold">${escapeHtml(s.businessPhone)}</a>` : ""} if you can't make it.
    </div>`;

  const html = emailShell({
    accent: ACCENT,
    heading: "Your booking is confirmed", // booking-generate: business-type wording
    intro: `Thank you for booking with ${s.businessName}. We look forward to seeing you.`,
    bodyHtml: [
      refBadge("Booking reference", b.bookingRef, ACCENT),
      detailsTable(coreRows(s, b)),
      b.specialRequests
        ? `<p style="margin-top:14px;color:#666">Special requests: <em>${escapeHtml(b.specialRequests)}</em></p>`
        : "",
      policyBox,
      ctaButton("Change or cancel my booking", cancelUrl, ACCENT),
      `<p style="text-align:center;color:#999;font-size:12px">A calendar invite is attached.</p>`,
    ].join(""),
    footerText: footer(s),
  });

  const text = [
    `Your booking is confirmed — ${s.businessName}`,
    `Ref: ${b.bookingRef}`,
    `${longDate}, ${timeLabel}`,
    guestsLabel(b.partySize),
    b.specialRequests ? `Special requests: ${b.specialRequests}` : null,
    "",
    `Plans change? Pick a new time or cancel online up to ${s.cutoffHours} hours before your booking:`,
    cancelUrl,
    s.businessPhone ? `After that, please call ${s.businessPhone}.` : null,
  ]
    .filter((l) => l !== null)
    .join("\n");

  await sendMail({
    to: b.customerEmail,
    fromName: s.businessName,
    replyTo: s.businessEmail,
    subject: `Your ${s.businessName} booking — ${longDate}, ${timeLabel}`,
    icalEvent: icsFor(s, b),
    html,
    text,
  });
}

// ─── Owner notification — sent on every new customer booking ────────────────

export async function sendOwnerNotification(
  s: BookingSettings,
  b: EmailBooking,
  visitNumber?: number | null
): Promise<void> {
  const safeName = b.customerName.replace(/[\r\n]+/g, " ").slice(0, 80);
  const longDate = formatLongDate(b.date, s.locale);
  const timeLabel = formatTimeLabel(b.slotTime, s.locale);
  const phoneHref = b.customerPhone.replace(/\s+/g, "");
  const historyLabel =
    visitNumber == null ? null : visitNumber <= 1 ? "First-time customer" : `Returning customer — booking #${visitNumber}`;

  const rows = [
    ...coreRows(s, b),
    detailRow("Name", escapeHtml(b.customerName)),
    detailRow(
      "Phone",
      b.customerPhone
        ? `<a href="tel:${escapeHtml(phoneHref)}" style="color:${ACCENT}">${escapeHtml(b.customerPhone)}</a>`
        : "—"
    ),
    detailRow(
      "Email",
      b.customerEmail
        ? `<a href="mailto:${escapeHtml(b.customerEmail)}" style="color:${ACCENT}">${escapeHtml(b.customerEmail)}</a>`
        : "—"
    ),
  ];
  if (historyLabel) rows.push(detailRow("History", escapeHtml(historyLabel)));
  if (b.specialRequests) {
    rows.push(detailRow("Requests", `<em>${escapeHtml(b.specialRequests)}</em>`));
  }

  const html = emailShell({
    accent: ACCENT,
    heading: "New booking",
    intro: `Ref: ${b.bookingRef}`,
    bodyHtml: detailsTable(rows),
    footerText: footer(s),
  });

  const text = [
    `New booking: ${b.bookingRef}`,
    `${b.customerName} — ${longDate}, ${timeLabel}`,
    guestsLabel(b.partySize),
    b.customerPhone ? `Phone: ${b.customerPhone}` : null,
    b.customerEmail ? `Email: ${b.customerEmail}` : null,
    historyLabel ? `History: ${historyLabel}` : null,
    b.specialRequests ? `Requests: ${b.specialRequests}` : null,
  ]
    .filter((l) => l !== null)
    .join("\n");

  await sendMail({
    to: s.businessEmail,
    fromName: `${s.businessName} Bookings`,
    // Reply-To = customer so the owner can hit Reply to talk to the guest
    // directly. Omit when a phone booking has no email.
    replyTo: b.customerEmail.trim() || undefined,
    subject: `New booking: ${safeName} — ${longDate}, ${timeLabel} (${guestsLabel(b.partySize)})`,
    html,
    text,
  });
}

// ─── Day-of reminder — sent by the morning cron ─────────────────────────────

export async function sendCustomerReminder(
  s: BookingSettings,
  b: EmailBooking
): Promise<void> {
  const longDate = formatLongDate(b.date, s.locale);
  const timeLabel = formatTimeLabel(b.slotTime, s.locale);

  const html = emailShell({
    accent: ACCENT,
    heading: "See you today", // booking-generate: business-type wording
    intro: `A quick reminder of your booking with ${s.businessName} today.`,
    bodyHtml: [
      detailsTable([...coreRows(s, b), detailRow("Reference", escapeHtml(b.bookingRef))]),
      s.businessAddress
        ? `<p style="margin-top:18px;color:#666;font-size:14px">Address: ${escapeHtml(s.businessAddress)}</p>`
        : "",
      `<p style="margin-top:18px;color:#999;font-size:12px;font-style:italic;text-align:center">
        Online cancellation has now closed. If you can't make it, please call us${s.businessPhone ? ` on ${escapeHtml(s.businessPhone)}` : ""} so we can offer your place to someone else.
      </p>`,
    ].join(""),
    footerText: footer(s),
  });

  const text = [
    `See you today at ${s.businessName}`,
    `${longDate}, ${timeLabel}`,
    guestsLabel(b.partySize),
    `Ref: ${b.bookingRef}`,
    s.businessAddress ? `Address: ${s.businessAddress}` : null,
    "",
    `(Online cancellation has closed. ${s.businessPhone ? `Please call ${s.businessPhone} if you can't make it.` : "Please contact us if you can't make it."})`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  await sendMail({
    to: b.customerEmail,
    fromName: s.businessName,
    replyTo: s.businessEmail,
    subject: `Today: your ${s.businessName} booking at ${timeLabel}`,
    html,
    text,
    icalEvent: icsFor(s, b),
  });
}

// ─── Reschedule emails — both directions ────────────────────────────────────

export async function sendCustomerReschedule(
  s: BookingSettings,
  b: EmailBooking,
  oldDate: string,
  oldSlotTime: string,
  cancelUrl: string
): Promise<void> {
  const longDate = formatLongDate(b.date, s.locale);
  const timeLabel = formatTimeLabel(b.slotTime, s.locale);
  const oldLabel = `${formatLongDate(oldDate, s.locale)}, ${formatTimeLabel(oldSlotTime, s.locale)}`;

  const html = emailShell({
    accent: ACCENT,
    heading: "Your booking has been moved", // booking-generate: business-type wording
    intro: `Your booking with ${s.businessName} has a new time. Here are the updated details.`,
    bodyHtml: [
      refBadge("New booking reference", b.bookingRef, ACCENT),
      detailsTable(coreRows(s, b)),
      `<p style="margin-top:14px;color:#666">Previously: <s>${escapeHtml(oldLabel)}</s></p>`,
      ctaButton("Change or cancel my booking", cancelUrl, ACCENT),
      `<p style="text-align:center;color:#999;font-size:12px">An updated calendar invite is attached — if you added the old time to your calendar, please remove it.</p>`,
    ].join(""),
    footerText: footer(s),
  });

  const text = [
    `Your ${s.businessName} booking has been moved`,
    `New ref: ${b.bookingRef}`,
    `Now: ${longDate}, ${timeLabel}`,
    guestsLabel(b.partySize),
    `Previously: ${oldLabel}`,
    "",
    `Change or cancel online (up to ${s.cutoffHours} hours before):`,
    cancelUrl,
  ].join("\n");

  await sendMail({
    to: b.customerEmail,
    fromName: s.businessName,
    replyTo: s.businessEmail,
    subject: `Booking moved — now ${longDate}, ${timeLabel}`,
    html,
    text,
    icalEvent: icsFor(s, b),
  });
}

export async function sendOwnerReschedule(
  s: BookingSettings,
  b: EmailBooking,
  oldDate: string,
  oldSlotTime: string,
  visitNumber?: number | null
): Promise<void> {
  const safeName = b.customerName.replace(/[\r\n]+/g, " ").slice(0, 80);
  const longDate = formatLongDate(b.date, s.locale);
  const timeLabel = formatTimeLabel(b.slotTime, s.locale);
  const oldLabel = `${formatLongDate(oldDate, s.locale)}, ${formatTimeLabel(oldSlotTime, s.locale)}`;
  const historyLabel =
    visitNumber == null ? null : visitNumber <= 1 ? "First-time customer" : `Returning customer — booking #${visitNumber}`;

  const rows = [
    ...coreRows(s, b),
    detailRow("Previously", escapeHtml(oldLabel)),
    detailRow(
      "Customer",
      `${escapeHtml(b.customerName)}${b.customerPhone ? ` · ${escapeHtml(b.customerPhone)}` : ""}${b.customerEmail ? ` · ${escapeHtml(b.customerEmail)}` : ""}`
    ),
  ];
  if (historyLabel) rows.push(detailRow("History", escapeHtml(historyLabel)));

  const html = emailShell({
    accent: ACCENT,
    heading: "Booking rescheduled by customer",
    intro: `New ref: ${b.bookingRef}`,
    bodyHtml: [
      detailsTable(rows),
      `<p style="color:#666">The old time has been freed up.</p>`,
    ].join(""),
    footerText: footer(s),
  });

  const text = [
    `Booking rescheduled: ${b.bookingRef}`,
    `${b.customerName} — now ${longDate}, ${timeLabel}`,
    guestsLabel(b.partySize),
    `Previously: ${oldLabel}`,
    b.customerPhone ? `Phone: ${b.customerPhone}` : null,
    b.customerEmail ? `Email: ${b.customerEmail}` : null,
    historyLabel ? `History: ${historyLabel}` : null,
  ]
    .filter((l) => l !== null)
    .join("\n");

  await sendMail({
    to: s.businessEmail,
    fromName: `${s.businessName} Bookings`,
    replyTo: b.customerEmail.trim() || undefined,
    subject: `Rescheduled: ${safeName} — now ${longDate}, ${timeLabel}`,
    html,
    text,
  });
}

// ─── Cancellation emails — both directions ──────────────────────────────────

export async function sendCustomerCancellation(
  s: BookingSettings,
  b: EmailBooking,
  cancelledBy: "customer" | "business"
): Promise<void> {
  const longDate = formatLongDate(b.date, s.locale);
  const timeLabel = formatTimeLabel(b.slotTime, s.locale);
  const callLink = s.businessPhone
    ? ` or call us on <a href="tel:${escapeHtml(s.businessPhone.replace(/\s+/g, ""))}" style="color:${ACCENT};font-weight:bold">${escapeHtml(s.businessPhone)}</a>`
    : "";

  const intro =
    cancelledBy === "business"
      ? `We're sorry — we've had to cancel your booking with us. If you'd like to rebook${callLink ? `, book online${callLink}` : ", you can book online any time"}.`
      : `Your booking has been cancelled. If this was a mistake, you can book again any time${callLink}.`;

  const html = emailShell({
    accent: "#b13a3a",
    heading: "Booking cancelled",
    bodyHtml: [
      `<p style="color:#666">${intro}</p>`,
      refBadge("Reference", b.bookingRef, ACCENT),
      detailsTable(coreRows(s, b)),
    ].join(""),
    footerText: footer(s),
  });

  const text = [
    cancelledBy === "business"
      ? `Your ${s.businessName} booking has been cancelled by the business.`
      : `Your ${s.businessName} booking has been cancelled.`,
    `Ref: ${b.bookingRef}`,
    `${longDate}, ${timeLabel}`,
    guestsLabel(b.partySize),
    "",
    cancelledBy === "business"
      ? `We're sorry for any inconvenience.${s.businessPhone ? ` To rebook or for any questions, call us on ${s.businessPhone}.` : ""}`
      : `If this was a mistake, you can book again any time.${s.businessPhone ? ` Questions? Call ${s.businessPhone}.` : ""}`,
  ].join("\n");

  await sendMail({
    to: b.customerEmail,
    fromName: s.businessName,
    replyTo: s.businessEmail,
    subject:
      cancelledBy === "business"
        ? `Your ${s.businessName} booking has been cancelled`
        : `Your ${s.businessName} booking is cancelled`,
    html,
    text,
  });
}

export async function sendOwnerCancellation(
  s: BookingSettings,
  b: EmailBooking,
  cancelledBy: "customer" | "business",
  reason?: string
): Promise<void> {
  const longDate = formatLongDate(b.date, s.locale);
  const timeLabel = formatTimeLabel(b.slotTime, s.locale);
  // The owner gets this even for their own dashboard cancels — it's their
  // written record that the cancel went through (a real owner asked for
  // exactly this after an accidental cancel left no trace).
  const heading =
    cancelledBy === "business"
      ? "Booking cancelled from the dashboard"
      : "Booking cancelled by customer";
  const trimmedReason = reason?.trim() || "";

  const rows = [
    ...coreRows(s, b),
    detailRow(
      "Customer",
      `${escapeHtml(b.customerName)}${b.customerPhone ? ` · ${escapeHtml(b.customerPhone)}` : ""}${b.customerEmail ? ` · ${escapeHtml(b.customerEmail)}` : ""}`
    ),
  ];
  if (trimmedReason) rows.push(detailRow("Reason", escapeHtml(trimmedReason)));

  const html = emailShell({
    accent: "#b13a3a",
    heading,
    intro: `Ref: ${b.bookingRef}`,
    bodyHtml: [
      detailsTable(rows),
      `<p style="color:#666">Capacity has been returned to this time slot.</p>`,
    ].join(""),
    footerText: footer(s),
  });

  const text = [
    `${heading}: ${b.bookingRef}`,
    `${b.customerName} — ${longDate}, ${timeLabel}`,
    guestsLabel(b.partySize),
    b.customerPhone ? `Phone: ${b.customerPhone}` : null,
    b.customerEmail ? `Email: ${b.customerEmail}` : null,
    trimmedReason ? `Reason: ${trimmedReason}` : null,
  ]
    .filter((l) => l !== null)
    .join("\n");

  await sendMail({
    to: s.businessEmail,
    fromName: `${s.businessName} Bookings`,
    replyTo: b.customerEmail.trim() || undefined,
    subject:
      cancelledBy === "business"
        ? `Cancelled (dashboard): ${b.customerName} — ${longDate}, ${timeLabel}`
        : `Cancellation: ${b.customerName} — ${longDate}, ${timeLabel}`,
    html,
    text,
  });
}
