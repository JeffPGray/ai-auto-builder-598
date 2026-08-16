#!/usr/bin/env python3
"""
imessage.py - Send and read SMS messages via macOS Messages.app.

macOS only. For cross-platform SMS support, use scripts/twilio_sms.py instead.

Usage:
  python3 scripts/imessage.py send --to "+12025550123" --body "Message body"
  python3 scripts/imessage.py send --to "+447123456789" --body "..." --dry-run
  python3 scripts/imessage.py read --phone "+12025550123" [--limit 20]

Sending uses Messages.app's AppleScript interface. The script picks iMessage
if any prior message in the thread was iMessage, otherwise falls back to SMS.

Reading uses the local Messages SQLite database at ~/Library/Messages/chat.db.
That requires Full Disk Access for both your terminal app and the Python binary
(System Settings > Privacy & Security > Full Disk Access).

Phone number format:
  Numbers MUST be in E.164 form with a leading + and country code:
    +12025550123 (US)
    +447123456789 (UK)
    +491521234567 (Germany)
    +61412345678 (Australia)
  Klaudius's pipeline gets phone numbers from the Google Places API (which
  always returns E.164), so in practice this is already what you'll have.
  E.164 is also what chat.db's chat_identifier uses for SMS threads, so
  read lookups only match when the input is E.164.
"""

import argparse
import json
from typing import Optional
import os
import re
import sqlite3
import subprocess
import sys
import time
import urllib.request
from datetime import datetime

# Windows stdout/stderr default to cp1252, and client-authored text is
# routinely emoji-bearing — printing it dies with UnicodeEncodeError, which
# killed a real operator's reply check mid-run (2026-07-17). Force UTF-8:
# everything that consumes this output (Claude Code, the skills, sibling
# scripts capturing the pipe) reads it as UTF-8, and errors="replace" keeps
# any hostile byte from crashing a run. (This script is macOS-only in
# practice, but it is imported by sync_thread_state on every platform.)
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


# AppleScript service type identifiers. We look up the user's actual
# iMessage / SMS service by type at send time, which is portable across
# Macs (the underlying service `id` GUIDs are installation-specific and
# would NOT work if hardcoded).
SERVICE_TYPE_IMESSAGE = "iMessage"
SERVICE_TYPE_SMS = "SMS"

CHAT_DB = os.path.expanduser("~/Library/Messages/chat.db")
SMS_SEND_INTERVAL = 20  # seconds between sends to avoid carrier spam detection
_SMS_TIMESTAMP_FILE = "/tmp/.sms_last_send_time"


def normalize_phone(phone: str) -> str:
    """Strip incidental whitespace + common separators from a phone number.

    chat.db stores SMS thread chat_identifiers in E.164 form (after Apple's
    own normalisation at send time, based on the Mac's region setting), so
    read lookups only match when the input is E.164. Klaudius's pipeline
    always stores phones in E.164 because they come from the Google Places
    API, so in practice the input is already correct and we just need to
    strip whitespace operators or display formatting that may have leaked
    in.

    Deliberately does NOT do any country-specific national-to-E.164
    conversion. The same national-format prefix can mean different
    countries with totally different country codes (e.g. `0712 345 6789`
    is a UK mobile but the same digits could parse as a national number
    in other countries). Operator-locale-aware normalisation belongs
    upstream of this script — preferably never, because Places API
    already returns E.164. If a non-E.164 input reaches this script we
    warn loudly so the source gets fixed.
    """
    phone = phone.strip()
    # Remove common display separators (spaces, dashes, parens, dots).
    phone = re.sub(r"[\s().\-]", "", phone)
    if phone and not phone.startswith("+"):
        print(
            f"WARN: phone {phone!r} is not in E.164 format (must start with + "
            f"and country code, e.g. +12025550123). chat.db lookups will not "
            f"match unless the chat_identifier was stored in this same "
            f"non-E.164 form. Klaudius normally stores phones in E.164 from "
            f"the Google Places API; if this came from manual entry, fix the "
            f"source.",
            file=sys.stderr,
        )
    return phone


def extract_text_from_attributed_body(abody: Optional[bytes]) -> Optional[str]:
    """Extract plain text from an attributedBody binary blob.

    The blob is a typedstream archive. The body is a length-prefixed UTF-8
    run: the NSString/NSMutableString class marker, a few variable framing
    bytes, a `+` (0x2b) tag, the declared length, then exactly that many
    bytes of text. Lengths < 0x80 are a single byte; longer strings use
    0x81 followed by a little-endian uint16. (Bodies >= 64 KiB would use
    0x82 + uint32; deliberately unhandled — unreachable for SMS-scale
    messages, and returning None falls back safely.) Parsing the declared length
    (rather than regex-matching on a lossy utf-8 decode, as this function
    used to) is what keeps framing bytes out of the result — the old
    approach corrupted essentially every body (dropped first characters,
    `tring+` artifacts, trailing `iI2` junk).
    """
    if not abody:
        return None
    try:
        marker = abody.find(b"NSString")
        if marker == -1:
            return None
        tag = abody.find(b"+", marker, marker + 16)
        if tag == -1:
            return None
        pos = tag + 1
        length = abody[pos]
        pos += 1
        if length == 0x81:
            length = int.from_bytes(abody[pos:pos + 2], "little")
            pos += 2
        elif length >= 0x80:
            return None
        raw = abody[pos:pos + length]
        if len(raw) < length:
            return None
        return raw.decode("utf-8", errors="replace").strip() or None
    except Exception:
        return None


def get_thread_service_type(recipient: str) -> str:
    """Determine whether to send via iMessage or SMS for this recipient.

    Returns SERVICE_TYPE_IMESSAGE if:
      - The chat row itself has service_name='iMessage', OR
      - Any past message in the thread was delivered via iMessage, OR
      - The handle for this recipient is registered with service='iMessage'.

    Otherwise returns SERVICE_TYPE_SMS. Checking chat.service_name alone misses
    recipients whose first message went via SMS but later ones went iMessage
    (the chat row keeps its original service_name).
    """
    conn = sqlite3.connect(CHAT_DB)
    cur = conn.cursor()

    cur.execute(
        "SELECT 1 FROM chat WHERE chat_identifier = ? AND service_name = 'iMessage' LIMIT 1",
        (recipient,),
    )
    if cur.fetchone():
        conn.close()
        return SERVICE_TYPE_IMESSAGE

    cur.execute(
        """
        SELECT 1
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE c.chat_identifier = ? AND m.service = 'iMessage'
        LIMIT 1
        """,
        (recipient,),
    )
    if cur.fetchone():
        conn.close()
        return SERVICE_TYPE_IMESSAGE

    cur.execute(
        "SELECT 1 FROM handle WHERE id = ? AND service = 'iMessage' LIMIT 1",
        (recipient,),
    )
    if cur.fetchone():
        conn.close()
        return SERVICE_TYPE_IMESSAGE

    conn.close()
    return SERVICE_TYPE_SMS


def read_conversation(phone: str, limit: int = 20) -> list[dict]:
    """Read conversation thread with a phone number from chat.db."""
    phone = normalize_phone(phone)
    conn = sqlite3.connect(CHAT_DB)
    cur = conn.cursor()
    cur.execute(
        """
        SELECT m.text, m.attributedBody, m.is_from_me,
               datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime') as msg_date
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE c.chat_identifier = ?
        ORDER BY m.date DESC
        LIMIT ?
        """,
        (phone, limit),
    )
    messages = []
    for text, abody, is_from_me, msg_date in cur.fetchall():
        body = text or extract_text_from_attributed_body(abody)
        messages.append({
            "date": msg_date,
            "from_me": bool(is_from_me),
            "text": body or "(unable to read)",
        })
    conn.close()
    # Return in chronological order
    messages.reverse()
    return messages




def _deployed_url_regex() -> str:
    """URL shapes the pre-send liveness check treats as deployed-site links.
    The hosted providers are fixed hosts. A self-hosted install
    (DEPLOY_PROVIDER=selfhost) serves sites on the operator's own domain
    instead — derive its host shape from SELFHOST_URL_TEMPLATE so those
    URLs get the same check rather than silently skipping it."""
    pattern = r'https?://[a-zA-Z0-9._-]+\.(?:vercel\.app|pages\.dev|netlify\.app)\S*'
    tmpl = os.environ.get("SELFHOST_URL_TEMPLATE", "")
    if not tmpl:
        env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
        try:
            with open(env_path) as f:
                for line in f:
                    if line.strip().startswith("SELFHOST_URL_TEMPLATE="):
                        tmpl = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
        except OSError:
            pass
    m = re.match(r'https?://([^/\s]+)', tmpl)
    if m:
        host = re.escape(m.group(1)).replace(re.escape('{slug}'), r'[a-zA-Z0-9-]+')
        pattern = r'https?://' + host + r'\S*|' + pattern
    return pattern


def verify_urls_in_message(body: str) -> list[str]:
    """Extract all deployed-site URLs (vercel.app / pages.dev / netlify.app) from a
    message body and verify each returns HTTP 200. Returns a list of error strings for
    any broken URLs. Empty list = all OK."""
    urls = re.findall(_deployed_url_regex(), body)
    errors = []
    for url in urls:
        # Strip trailing punctuation that might have been captured
        url = url.rstrip('.,;:!?')
        try:
            result = subprocess.run(
                ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "10", url],
                # encoding= always accompanies text=True in this codebase:
                # bare text=True decodes with the locale default (cp1252 on
                # Windows), which is how an emoji in captured output once made
                # a client reply invisible (sync_thread_state, 2026-07-27).
                capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15,
            )
            code = result.stdout.strip()
            if code != "200":
                errors.append(f"{url} returned HTTP {code}")
        except Exception as e:
            errors.append(f"{url} check failed: {e}")
    return errors


def _verify_outbound_service(recipient: str, sent_after_unix: float, timeout: float = 12.0) -> Optional[str]:
    """Poll chat.db for the most recent outbound message to `recipient` newer than
    `sent_after_unix`. Returns the service string ('iMessage' / 'SMS') if a row
    appears and chat.db's `error` column stays 0 throughout the poll window.
    Returns None if nothing shows up within `timeout` seconds or if the row's
    `error` column is non-zero (e.g. error=33 when iMessage auth is broken).

    Note: we don't gate on is_sent==1 because Apple sometimes leaves successful
    iMessages at is_sent=0 indefinitely. error!=0 is the reliable failure signal.

    chat.db stores message dates as Mac-absolute nanoseconds since 2001-01-01,
    so we convert our unix timestamp into the same epoch for comparison.
    """
    mac_epoch_offset = 978307200
    threshold_mac_ns = int((sent_after_unix - mac_epoch_offset) * 1_000_000_000)
    deadline = time.time() + timeout
    last_service = None
    while time.time() < deadline:
        try:
            conn = sqlite3.connect(CHAT_DB)
            cur = conn.cursor()
            cur.execute(
                """
                SELECT m.service, m.error, m.is_sent
                FROM message m
                JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
                JOIN chat c ON cmj.chat_id = c.ROWID
                WHERE c.chat_identifier = ?
                  AND m.is_from_me = 1
                  AND m.date >= ?
                ORDER BY m.date DESC
                LIMIT 1
                """,
                (recipient, threshold_mac_ns),
            )
            row = cur.fetchone()
            conn.close()
            if row and row[0]:
                service, error, is_sent = row
                if error and error != 0:
                    print(
                        f"ERROR: chat.db reports send to {recipient} failed "
                        f"(service={service}, error={error}, is_sent={is_sent}). "
                        f"Likely causes: iMessage auth broken on this Mac, "
                        f"recipient unreachable, or carrier rejected SMS.",
                        file=sys.stderr,
                    )
                    return None
                last_service = service
        except sqlite3.Error:
            pass
        time.sleep(0.4)
    return last_service


def send_sms(to: str, body: str, dry_run: bool = False, verify_urls: bool = True) -> bool:
    """Send a message via Messages.app AppleScript. Uses iMessage if an existing
    iMessage thread exists with the recipient, otherwise falls back to SMS.

    `verify_urls=False` (the `--no-url-check` flag) skips the deployed-URL
    liveness gate — operator alerts routed through this script are often
    *about* a dead URL and must not be blocked by it.

    After osascript dispatches the message, we poll chat.db for ~12s to confirm
    the message landed without an error. osascript exit 0 alone is not a
    reliable success signal: if iCloud / iMessage auth is broken on the Mac,
    Messages.app accepts the dispatch but later marks the message error=33
    in chat.db. Without this verification step we'd report sends as
    successful that the recipient never actually received."""
    to = normalize_phone(to)

    if verify_urls:
        # Verify all deployed-site URLs in the message are live before sending
        url_errors = verify_urls_in_message(body)
        if url_errors:
            print(f"BLOCKED: Message contains broken URLs:", file=sys.stderr)
            for err in url_errors:
                print(f"  - {err}", file=sys.stderr)
            print("Fix the deployment before sending.", file=sys.stderr)
            return False

    # Fix literal unicode escape sequences
    body = re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), body)

    # Escape for AppleScript
    escaped_body = body.replace("\\", "\\\\").replace('"', '\\"')
    escaped_to = to.replace('"', '\\"')

    service_type = get_thread_service_type(to)

    # Look up the service by service type at send time. Service GUIDs (`id`)
    # are installation-specific on macOS, so we never hardcode them.
    script = f'''
    tell application "Messages"
        set targetService to first service whose service type is {service_type}
        set targetBuddy to participant "{escaped_to}" of targetService
        send "{escaped_body}" to targetBuddy
    end tell
    '''

    if dry_run:
        print(f"[DRY RUN] Would send {service_type} to {to}:")
        print(f"  Body: {body[:100]}...")
        return True

    # Rate limit: wait if needed to maintain SMS_SEND_INTERVAL between sends.
    # Timestamp persisted to file so it works across separate process invocations.
    last_send = 0.0
    try:
        with open(_SMS_TIMESTAMP_FILE) as f:
            last_send = float(f.read().strip())
    except (FileNotFoundError, ValueError):
        pass
    elapsed = time.time() - last_send
    if last_send > 0 and elapsed < SMS_SEND_INTERVAL:
        wait = SMS_SEND_INTERVAL - elapsed
        print(f"Rate limit: waiting {wait:.0f}s before next send...")
        time.sleep(wait)

    print(f"Sending {service_type} to {to}...")
    sent_after_unix = time.time()
    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True,
        text=True,
        # See the curl call above: encoding= always accompanies text=True.
        encoding="utf-8",
        errors="replace",
        timeout=30,
    )

    if result.returncode != 0:
        print(f"ERROR: Failed to send {service_type}: {result.stderr}", file=sys.stderr)
        return False

    # Post-send verification via chat.db. Defends against silent failures
    # (e.g. iCloud auth broken → Messages.app accepts the dispatch and later
    # marks the row error=33). Returns the actual service used, or None on
    # failure / timeout.
    verified_service = _verify_outbound_service(to, sent_after_unix)
    if verified_service is None:
        print(
            f"ERROR: Could not verify {service_type} send to {to} via chat.db "
            f"within 12s. Treating as failure so the caller doesn't mark the "
            f"row 'outreach_sent' on a message that may not have landed.",
            file=sys.stderr,
        )
        return False

    with open(_SMS_TIMESTAMP_FILE, "w") as f:
        f.write(str(time.time()))
    print(f"{verified_service} sent successfully to {to}")
    return True


def main():
    parser = argparse.ArgumentParser(description="Send and read SMS via macOS Messages.app (iMessage / SMS)")
    sub = parser.add_subparsers(dest="command", required=True)

    # Send
    send_parser = sub.add_parser("send", help="Send an SMS")
    send_parser.add_argument("--to", required=True, help="Recipient phone in E.164 format (e.g. +12025550123, +447123456789, +491521234567)")
    send_parser.add_argument("--body", required=True, help="Message body")
    send_parser.add_argument("--dry-run", action="store_true", help="Print but don't send")
    send_parser.add_argument("--no-url-check", action="store_true",
                             help="Skip the deployed-URL liveness gate (operator alerts only - never for client outreach)")

    # Read
    read_parser = sub.add_parser("read", help="Read conversation with a phone number")
    read_parser.add_argument("--phone", required=True, help="Phone number in E.164 format (e.g. +12025550123)")
    read_parser.add_argument("--limit", type=int, default=20, help="Max messages to return")

    args = parser.parse_args()

    if args.command == "send":
        success = send_sms(args.to, args.body, dry_run=args.dry_run, verify_urls=not args.no_url_check)
        sys.exit(0 if success else 1)

    elif args.command == "read":
        messages = read_conversation(args.phone, limit=args.limit)
        if not messages:
            print(f"No messages found for {args.phone}")
            sys.exit(0)
        for msg in messages:
            direction = "ME" if msg["from_me"] else "THEM"
            print(f"[{msg['date']}] {direction}: {msg['text']}")


if __name__ == "__main__":
    main()
