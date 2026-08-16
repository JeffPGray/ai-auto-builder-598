#!/usr/bin/env python3
"""
twilio_sms.py - Send and read SMS messages via Twilio.

Cross-platform SMS support for Klaudius. Use this on Linux, Windows / WSL,
or macOS buyers who prefer Twilio over iMessage. Reads TWILIO_ACCOUNT_SID,
TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER from the project .env (set by
the Klaudius wizard).

Usage:
  python3 scripts/twilio_sms.py send --to "+15555551234" --body "Message body"
  python3 scripts/twilio_sms.py send --to "+15555551234" --body "Message body" --dry-run
  python3 scripts/twilio_sms.py read --phone "+15555551234" [--limit 20]

The CLI surface mirrors scripts/imessage.py so the outreach / follow-up /
warm-leads skills can swap between the two transparently based on whether
the operator configured TWILIO_* or chose iMessage.

Phone number format:
  Numbers MUST be in E.164 form with a leading + and country code:
    +12025550123 (US)
    +447123456789 (UK)
    +491521234567 (Germany)
    +61412345678 (Australia)
    +33612345678 (France)
  Twilio's API rejects anything else. Klaudius's pipeline gets phone
  numbers from the Google Places API (which always returns E.164), so
  in practice this is already what you'll have.
"""

# Make Python's ssl module trust the OS root-CA store before urllib opens
# its first HTTPS connection to Twilio. Without this, Windows machines whose
# antivirus / corporate-proxy MITMs HTTPS hit cert-verification failures on
# every Twilio API call. No-op on systems without interception. Guarded so
# older Klaudius setups (pre-0.7.1, no truststore in pip install list) still
# run.
try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

import argparse
import base64
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# Windows stdout/stderr default to cp1252, and client-authored text is
# routinely emoji-bearing — printing it dies with UnicodeEncodeError, which
# killed a real operator's reply check mid-run (2026-07-17). Force UTF-8:
# everything that consumes this output (Claude Code, the skills, sibling
# scripts capturing the pipe) reads it as UTF-8, and errors="replace" keeps
# any hostile byte from crashing a run.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    # python-dotenv not installed — rely on env vars being set externally.
    pass


TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM_NUMBER = os.environ.get("TWILIO_PHONE_NUMBER", "")

TWILIO_BASE = "https://api.twilio.com/2010-04-01"

SMS_SEND_INTERVAL = 20  # seconds between sends to avoid carrier spam detection
# Cross-process rate-limit timestamp. tempfile.gettempdir() honors TMPDIR/%TEMP%,
# giving a stable per-user path that's consistent across repeated twilio_sms.py
# runs (so parallel sends still coordinate) and — unlike the old hardcoded
# "/tmp" — actually exists on Windows. imessage.py keeps its own /tmp path; only
# one SMS provider is ever active per install, so they never need to share this.
_SMS_TIMESTAMP_FILE = os.path.join(tempfile.gettempdir(), ".sms_last_send_time")

# How long to wait for Twilio to push the message past the carrier
# (status: queued/sending → sent/delivered/failed/undelivered) before
# returning. 12s matches imessage.py's chat.db verification window.
_STATUS_POLL_TIMEOUT = 12.0

# Terminal statuses meaning an outbound message never reached the recipient.
# Twilio's Messages list keeps these forever, so readers that count "touches"
# (sync_thread_state.py) must exclude them — same reason the chat.db reader
# skips outgoing rows with error != 0.
UNDELIVERED_STATUSES = ("failed", "undelivered", "canceled")


def _check_env() -> None:
    """Verify Twilio credentials are present before any API call."""
    missing = []
    if not TWILIO_ACCOUNT_SID:
        missing.append("TWILIO_ACCOUNT_SID")
    if not TWILIO_AUTH_TOKEN:
        missing.append("TWILIO_AUTH_TOKEN")
    if not TWILIO_FROM_NUMBER:
        missing.append("TWILIO_PHONE_NUMBER")
    if missing:
        print(
            f"ERROR: Missing Twilio credentials in .env: {', '.join(missing)}. "
            f"Run `npx klaudius configure` to set them.",
            file=sys.stderr,
        )
        sys.exit(1)


def normalize_phone(phone: str) -> str:
    """Strip incidental whitespace + common separators from a phone number.

    Twilio requires E.164 input (e.g. `+12025550123`, `+447123456789`,
    `+491521234567`). Klaudius's pipeline always stores phones in E.164
    because they come from the Google Places API, so in practice the
    input is already correct and we just need to strip whitespace
    operators or display formatting that may have leaked in.

    Deliberately does NOT do any country-specific national-to-E.164
    conversion. That kind of conversion is unsafe across countries
    without an explicit operator-country signal (e.g. `0712 345 6789`
    is a UK mobile, but `0712 345 6789` is also a possible national
    format in other countries with totally different country codes).
    If a non-E.164 input reaches this script, we warn loudly and let
    Twilio reject it rather than silently misroute the SMS.
    """
    phone = phone.strip()
    # Remove common display separators (spaces, dashes, parens, dots).
    phone = re.sub(r"[\s().\-]", "", phone)
    if phone and not phone.startswith("+"):
        print(
            f"WARN: phone {phone!r} is not in E.164 format (must start with + and "
            f"country code, e.g. +12025550123). Twilio will likely reject it. "
            f"Klaudius normally stores phones in E.164 from the Google Places API; "
            f"if this came from manual entry, fix the source.",
            file=sys.stderr,
        )
    return phone


def _twilio_request(
    method: str,
    path: str,
    params: Optional[dict] = None,
    form: Optional[dict] = None,
    timeout: float = 15.0,
) -> dict:
    """Make an authenticated request to Twilio's REST API.

    Returns the JSON-decoded response. Raises RuntimeError on non-2xx with
    Twilio's error message + code in the exception text.
    """
    url = f"{TWILIO_BASE}/Accounts/{TWILIO_ACCOUNT_SID}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)

    auth_header = base64.b64encode(
        f"{TWILIO_ACCOUNT_SID}:{TWILIO_AUTH_TOKEN}".encode()
    ).decode()

    headers = {
        "Authorization": f"Basic {auth_header}",
        "Accept": "application/json",
    }

    data = None
    if form is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        data = urllib.parse.urlencode(form).encode()

    req = urllib.request.Request(url, headers=headers, data=data, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body_text = ""
        try:
            body_text = e.read().decode()
            err_body = json.loads(body_text)
            err_msg = err_body.get("message", "unknown")
            err_code = err_body.get("code", e.code)
            raise RuntimeError(f"Twilio API error {err_code}: {err_msg}") from None
        except (json.JSONDecodeError, ValueError):
            snippet = body_text[:200] if body_text else e.reason
            raise RuntimeError(f"Twilio API error {e.code}: {snippet}") from None
    except urllib.error.URLError as e:
        raise RuntimeError(f"Could not reach Twilio: {e.reason}") from None


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
    message and verify each returns HTTP 200. Returns a list of error strings for any broken URLs.
    Empty list = all OK. Mirrors the same guard in imessage.py so a buyer can't
    accidentally send a dead link to a real prospect.

    Uses urllib rather than a curl subprocess so it behaves identically on
    Windows, where curl's `-o /dev/null` sink doesn't exist and would error out,
    turning every deployed URL into a false "broken link" that blocks the send.
    Redirects are followed (urllib's default), matching "does this link load for
    the client"."""
    urls = re.findall(_deployed_url_regex(), body)
    errors = []
    for url in urls:
        url = url.rstrip('.,;:!?')
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=10) as resp:
                code = resp.status
            if code != 200:
                errors.append(f"{url} returned HTTP {code}")
        except urllib.error.HTTPError as e:
            errors.append(f"{url} returned HTTP {e.code}")
        except Exception as e:
            errors.append(f"{url} check failed: {e}")
    return errors


def _verify_message_status(message_sid: str, timeout: float = _STATUS_POLL_TIMEOUT) -> Optional[str]:
    """Poll Twilio's message resource until it reaches a terminal state
    (sent / delivered / failed / undelivered) or the timeout fires.

    Returns the final status if a terminal state is reached, or the last
    observed status on timeout (typically `queued` or `sending`). Returns
    None on transient API errors throughout the poll window.

    `delivered` requires SMS delivery receipts which not every carrier
    supports — `sent` is also treated as success. `failed` and
    `undelivered` are real send failures.
    """
    deadline = time.time() + timeout
    last_status: Optional[str] = None
    while time.time() < deadline:
        try:
            resp = _twilio_request("GET", f"/Messages/{message_sid}.json")
            status = resp.get("status")
            if status:
                last_status = status
            if status in ("delivered", "sent", "failed", "undelivered"):
                return status
        except RuntimeError:
            # Transient — keep polling
            pass
        time.sleep(0.6)
    return last_status


def send_sms(to: str, body: str, dry_run: bool = False, verify_urls: bool = True) -> bool:
    """Send a SMS via Twilio's REST API.

    On success: returns True after Twilio reports `sent` or `delivered`
    within 12s, or after timeout if Twilio accepted the message (status
    queued / sending) but the carrier hadn't acknowledged yet. On failure:
    returns False with a clear error printed to stderr.

    `verify_urls=False` (the `--no-url-check` flag) skips the deployed-URL
    liveness gate — operator alerts routed through this script are often
    *about* a dead URL and must not be blocked by it.
    """
    _check_env()
    to = normalize_phone(to)

    if verify_urls:
        # Verify all deployed-site URLs in the message are live before sending.
        url_errors = verify_urls_in_message(body)
        if url_errors:
            print(f"BLOCKED: Message contains broken URLs:", file=sys.stderr)
            for err in url_errors:
                print(f"  - {err}", file=sys.stderr)
            print("Fix the deployment before sending.", file=sys.stderr)
            return False

    # Fix literal unicode escape sequences (mirrors imessage.py).
    body = re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), body)

    if dry_run:
        print(f"[DRY RUN] Would send Twilio SMS from {TWILIO_FROM_NUMBER} to {to}:")
        print(f"  Body: {body[:100]}...")
        return True

    # Rate limit between sends. Persisted to a tmp file so consecutive
    # script invocations honour the same throttle window.
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

    print(f"Sending Twilio SMS to {to}...")
    try:
        resp = _twilio_request(
            "POST",
            "/Messages.json",
            form={
                "From": TWILIO_FROM_NUMBER,
                "To": to,
                "Body": body,
            },
        )
    except RuntimeError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return False

    message_sid = resp.get("sid")
    initial_status = resp.get("status")

    if not message_sid:
        print(
            f"ERROR: Twilio response missing message SID. Full response: {resp}",
            file=sys.stderr,
        )
        return False

    # Poll for terminal status (sent / delivered / failed / undelivered).
    final_status = _verify_message_status(message_sid)

    if final_status in ("delivered", "sent"):
        with open(_SMS_TIMESTAMP_FILE, "w") as f:
            f.write(str(time.time()))
        print(f"Twilio SMS {final_status} to {to} (sid: {message_sid})")
        return True

    if final_status in ("failed", "undelivered"):
        # Pull error_code + error_message from the message resource for
        # the operator to triage.
        err_code = None
        err_msg = "unknown"
        try:
            err_resp = _twilio_request("GET", f"/Messages/{message_sid}.json")
            err_code = err_resp.get("error_code")
            err_msg = err_resp.get("error_message", "unknown")
        except RuntimeError:
            pass
        print(
            f"ERROR: Twilio reports send to {to} {final_status}. "
            f"error_code={err_code}, error_message={err_msg} (sid: {message_sid})",
            file=sys.stderr,
        )
        return False

    # Timeout — Twilio accepted the message (we have a SID) but no terminal
    # state observed within the poll window. The carrier is likely still
    # processing. We treat this as success because the rate-limiter is what
    # really matters at the caller site, but flag the unconfirmed state.
    print(
        f"WARN: Twilio accepted send to {to} (sid: {message_sid}, "
        f"last status: {initial_status or 'unknown'}) but did not reach a "
        f"terminal state within {int(_STATUS_POLL_TIMEOUT)}s. Likely still "
        f"propagating at the carrier.",
        file=sys.stderr,
    )
    with open(_SMS_TIMESTAMP_FILE, "w") as f:
        f.write(str(time.time()))
    return True


def _parse_twilio_date(d: Optional[str]) -> datetime:
    """Twilio dates come back as RFC 2822 UTC, e.g. 'Wed, 06 May 2026 14:23:01 +0000'."""
    if not d:
        return datetime.min.replace(tzinfo=timezone.utc)
    try:
        return datetime.strptime(d, "%a, %d %b %Y %H:%M:%S %z")
    except (ValueError, TypeError):
        return datetime.min.replace(tzinfo=timezone.utc)


def read_conversation(phone: str, limit: int = 20, raise_on_error: bool = False) -> list[dict]:
    """Read the SMS conversation thread with a phone number via Twilio's API.

    Twilio's Messages API doesn't support OR queries, so we make two GET
    calls (outbound + inbound) and merge by date.

    By default a failed direction-fetch degrades gracefully (WARN on stderr,
    partial results) — right for the interactive CLI. Pass raise_on_error=True
    when the result drives pipeline state (sync_thread_state.py): a thread
    missing its inbound half must fail loudly, not read as "no replies".
    """
    _check_env()
    phone = normalize_phone(phone)

    messages: list[dict] = []

    # Outbound: From=our_number, To=phone
    try:
        resp = _twilio_request(
            "GET",
            "/Messages.json",
            params={
                "From": TWILIO_FROM_NUMBER,
                "To": phone,
                "PageSize": str(limit),
            },
        )
        for msg in resp.get("messages", []):
            messages.append({
                "date": msg.get("date_sent") or msg.get("date_created"),
                "from_me": True,
                "text": msg.get("body") or "",
                "status": msg.get("status"),
                "sid": msg.get("sid"),
            })
    except RuntimeError as e:
        if raise_on_error:
            raise
        print(f"WARN: Could not fetch outbound messages: {e}", file=sys.stderr)

    # Inbound: From=phone, To=our_number
    try:
        resp = _twilio_request(
            "GET",
            "/Messages.json",
            params={
                "From": phone,
                "To": TWILIO_FROM_NUMBER,
                "PageSize": str(limit),
            },
        )
        for msg in resp.get("messages", []):
            messages.append({
                "date": msg.get("date_sent") or msg.get("date_created"),
                "from_me": False,
                "text": msg.get("body") or "",
                "status": msg.get("status"),
                "sid": msg.get("sid"),
            })
    except RuntimeError as e:
        if raise_on_error:
            raise
        print(f"WARN: Could not fetch inbound messages: {e}", file=sys.stderr)

    messages.sort(key=lambda m: _parse_twilio_date(m["date"]))
    # Trim to the most recent `limit` entries (oldest first).
    return messages[-limit:]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Send and read SMS via Twilio (cross-platform alternative to iMessage)"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    send_parser = sub.add_parser("send", help="Send an SMS")
    send_parser.add_argument(
        "--to", required=True,
        help="Recipient phone in E.164 format (e.g. +12025550123, +447123456789, +491521234567)",
    )
    send_parser.add_argument("--body", required=True, help="Message body")
    send_parser.add_argument("--dry-run", action="store_true", help="Print but don't send")
    send_parser.add_argument("--no-url-check", action="store_true",
                             help="Skip the deployed-URL liveness gate (operator alerts only - never for client outreach)")

    read_parser = sub.add_parser("read", help="Read conversation with a phone number")
    read_parser.add_argument(
        "--phone", required=True,
        help="Phone number in E.164 format (e.g. +12025550123)",
    )
    read_parser.add_argument(
        "--limit", type=int, default=20, help="Max messages to return",
    )
    read_parser.add_argument(
        "--strict", action="store_true",
        help="Exit non-zero if either direction fetch fails, instead of "
             "printing a partial thread (use when the result gates a send decision)",
    )

    args = parser.parse_args()

    if args.command == "send":
        success = send_sms(args.to, args.body, dry_run=args.dry_run, verify_urls=not args.no_url_check)
        sys.exit(0 if success else 1)
    elif args.command == "read":
        try:
            messages = read_conversation(args.phone, limit=args.limit, raise_on_error=args.strict)
        except RuntimeError as e:
            print(f"ERROR: {e}", file=sys.stderr)
            sys.exit(1)
        if not messages:
            print(f"No messages found for {args.phone}")
            sys.exit(0)
        for msg in messages:
            direction = "ME" if msg["from_me"] else "THEM"
            if msg["from_me"] and msg.get("status") in UNDELIVERED_STATUSES:
                # Surface dead sends so a reader never mistakes one for a
                # delivered touch (e.g. during same-day dedup checks).
                direction = f"ME [{msg['status']}]"
            print(f"[{msg['date']}] {direction}: {msg['text'] or '(no body)'}")


if __name__ == "__main__":
    main()
