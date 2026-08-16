import nodemailer, { type Transporter } from "nodemailer";

/**
 * SMTP transport + HTML building blocks for booking emails. Installed by the
 * Klaudius booking skill as `src/lib/booking/email.ts`. Generic plumbing — do
 * not edit per site (the per-site email copy lives in emails.ts).
 *
 * ONE transport covers both sending modes — only the env values differ:
 *
 *   Production (client has their own domain, verified in Resend):
 *     BOOKING_SMTP_HOST=smtp.resend.com  BOOKING_SMTP_PORT=465
 *     BOOKING_SMTP_USER=resend           BOOKING_SMTP_PASS=<resend api key>
 *     BOOKING_FROM_EMAIL=bookings@theirdomain.com
 *
 *   POC / demo (no domain yet — the operator's own mailbox sends):
 *     BOOKING_SMTP_HOST/PORT/USER/PASS = the operator's SMTP credentials
 *     BOOKING_FROM_EMAIL = the operator's own address (SMTP providers reject
 *     From addresses the account isn't authorised to send as)
 *
 * In both modes the From DISPLAY NAME is the business name, and Reply-To does
 * the human routing: customer-facing mail replies go to the business owner's
 * real inbox; owner-facing mail replies go to the customer. The From address
 * itself is send-only — never expect replies to land there.
 */

let cached: Transporter | null = null;

function getTransport(): Transporter {
  if (cached) return cached;
  const host = process.env.BOOKING_SMTP_HOST;
  const portRaw = parseInt(process.env.BOOKING_SMTP_PORT || "465", 10);
  const user = process.env.BOOKING_SMTP_USER;
  const pass = process.env.BOOKING_SMTP_PASS;
  if (!host || !user || !pass) {
    throw new Error("BOOKING_SMTP_HOST / BOOKING_SMTP_USER / BOOKING_SMTP_PASS must be set");
  }
  if (!Number.isInteger(portRaw) || portRaw < 1 || portRaw > 65535) {
    throw new Error(`BOOKING_SMTP_PORT is not a valid port: ${process.env.BOOKING_SMTP_PORT}`);
  }
  cached = nodemailer.createTransport({
    host,
    port: portRaw,
    secure: portRaw === 465, // 465 = implicit TLS
    // On 587 (STARTTLS) refuse to continue in plaintext if the upgrade is
    // stripped — otherwise an active MITM could read the SMTP credentials.
    requireTLS: portRaw !== 465,
    auth: { user, pass },
  });
  return cached;
}

// Header values must never contain line breaks — a CRLF smuggled through a
// customer name could otherwise try to inject extra headers. Applied
// centrally so no individual template can forget it.
function headerSafe(s: string, max: number): string {
  return s.replace(/[\r\n]+/g, " ").slice(0, max);
}

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Display name shown as the sender (the business name). */
  fromName: string;
  /** Where a reply actually goes. Omit only when there's no useful target. */
  replyTo?: string;
  /** Optional calendar part (from buildIcsEvent) — mail clients surface it as "add to calendar". */
  icalEvent?: { filename: string; content: string };
}

export async function sendMail(opts: MailInput): Promise<void> {
  const fromEmail = process.env.BOOKING_FROM_EMAIL;
  if (!fromEmail) throw new Error("BOOKING_FROM_EMAIL must be set");
  // Callers wrap sends in Promise.allSettled and log failures; throwing here
  // (rather than swallowing) is what makes those logs useful.
  await getTransport().sendMail({
    from: { name: headerSafe(opts.fromName, 100), address: fromEmail },
    to: opts.to,
    subject: headerSafe(opts.subject, 200),
    html: opts.html,
    text: opts.text,
    replyTo: opts.replyTo || undefined,
    icalEvent: opts.icalEvent
      ? { filename: opts.icalEvent.filename, method: "PUBLISH", content: opts.icalEvent.content }
      : undefined,
  });
}

// ─── Calendar attachment (ICS) ──────────────────────────────────────────────

/** RFC 5545 text escaping: backslash, semicolon, comma, newlines. */
function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Fold a content line at ≤74 OCTETS (RFC 5545 §3.1; continuation = CRLF +
 * space). Folds on code-point boundaries measured in UTF-8 bytes — a
 * char-count slice would split multi-byte characters (accents, emoji in a
 * business name) and overshoot the octet limit.
 */
function foldIcsLine(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 74) return line;
  const parts: string[] = [];
  let current = "";
  let budget = 74; // continuation lines lose 1 octet to the leading space
  for (const ch of line) {
    const chBytes = Buffer.byteLength(ch, "utf8");
    if (Buffer.byteLength(current, "utf8") + chBytes > budget) {
      parts.push(current);
      current = " " + ch;
      budget = 74;
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts.join("\r\n");
}

/**
 * Build a single-event ICS calendar for a booking confirmation/reminder.
 *
 * DTSTART/DTEND are deliberately FLOATING local time (no TZID, no UTC "Z"):
 * for a local business the customer's timezone is the business's timezone,
 * so floating time renders correctly in every calendar client without
 * shipping a VTIMEZONE block. Do not "fix" this to UTC — a UTC instant would
 * need a timezone conversion that floating time makes unnecessary, and a
 * wrong conversion shifts every appointment by the UTC offset.
 *
 * Known limitation: every booking gets a fresh UID, so a reschedule adds a
 * NEW event rather than updating the old one (updating would need a stable
 * UID + SEQUENCE across the reschedule chain, which isn't tracked). The
 * reschedule email copy asks the customer to remove the old entry.
 */
export function buildIcsEvent(opts: {
  /** Globally-unique event id, e.g. `${bookingRef}@${businessDomainOrName}`. */
  uid: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  summary: string;
  description: string;
  location: string;
  /** Shown as the event organizer — RFC 5546 requires one for METHOD:PUBLISH (Outlook cares). */
  organizer: { name: string; email: string };
  /** Attachment filename; use the variant's domain word ("appointment.ics" / "booking.ics"). */
  filename?: string;
}): { filename: string; content: string } {
  const d = opts.date.replace(/-/g, "");
  const start = `${d}T${opts.startTime.replace(":", "")}00`;
  const end = `${d}T${opts.endTime.replace(":", "")}00`;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  // Param values (CN) forbid double quotes; quoting the value covers the
  // , ; : that business names may contain.
  const organizerCn = opts.organizer.name.replace(/"/g, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Klaudius Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(opts.uid)}`,
    "SEQUENCE:0",
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeIcsText(opts.summary)}`,
    `DESCRIPTION:${escapeIcsText(opts.description)}`,
    opts.location ? `LOCATION:${escapeIcsText(opts.location)}` : null,
    `ORGANIZER;CN="${organizerCn}":mailto:${opts.organizer.email}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((l): l is string => l !== null);
  return {
    filename: opts.filename ?? "appointment.ics",
    content: lines.map(foldIcsLine).join("\r\n") + "\r\n",
  };
}

// ─── HTML building blocks (used by the per-site emails.ts) ──────────────────

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** One label/value row for the details table. Value is pre-escaped by caller only if it contains markup. */
export function detailRow(label: string, valueHtml: string): string {
  return `<tr><td style="padding:6px 0;color:#888;width:140px;vertical-align:top">${escapeHtml(
    label
  )}</td><td style="padding:6px 0;font-weight:bold;color:#333">${valueHtml}</td></tr>`;
}

export function detailsTable(rows: string[]): string {
  return `<table style="width:100%;border-collapse:collapse;margin:14px 0">${rows.join("")}</table>`;
}

/** Prominent reference badge block. */
export function refBadge(label: string, value: string, accent: string): string {
  return `<div style="background:#F7F6F3;border-radius:10px;padding:14px 18px;margin:18px 0">
    <div style="font-size:13px;color:#888">${escapeHtml(label)}</div>
    <div style="font-size:18px;font-weight:bold;color:${accent};letter-spacing:1px">${escapeHtml(value)}</div>
  </div>`;
}

/** Bordered call-to-action button, centred. */
export function ctaButton(label: string, url: string, accent: string): string {
  return `<div style="text-align:center;margin:24px 0">
    <a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 22px;color:${accent};border:1px solid ${accent};border-radius:6px;text-decoration:none;font-weight:bold">${escapeHtml(label)}</a>
  </div>`;
}

/** Full email wrapper: heading, optional intro, body, footer line. */
export function emailShell(opts: {
  accent: string;
  heading: string;
  intro?: string;
  bodyHtml: string;
  footerText: string;
}): string {
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
    <h2 style="color:${opts.accent};margin-bottom:4px">${escapeHtml(opts.heading)}</h2>
    ${opts.intro ? `<p style="color:#666;margin-top:0">${escapeHtml(opts.intro)}</p>` : ""}
    ${opts.bodyHtml}
    <div style="font-size:12px;color:#999;margin-top:30px;border-top:1px solid #eee;padding-top:14px">
      ${escapeHtml(opts.footerText)}
    </div>
  </div>`;
}
