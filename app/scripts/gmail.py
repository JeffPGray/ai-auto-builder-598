#!/usr/bin/env python3
"""
gmail.py - Generic email send/read client (SMTP for sending, IMAP for reading).

Despite the legacy name, this works with any SMTP+IMAP provider: Gmail, Outlook,
IONOS, Fastmail, Zoho, Yahoo, custom providers, etc. All configuration is loaded
from your .env file.

Usage:
  # Send a new email
  python3 scripts/gmail.py send --to "user@example.com" --subject "Subject" --body "Message body"

  # Save an email to Drafts WITHOUT sending (manual-approval / review-before-send mode).
  # --attach (repeatable) adds file attachments — used by /send-invoice for the PDF.
  python3 scripts/gmail.py draft --to "user@example.com" --subject "Subject" --body "Message body" [--attach invoice.pdf]

  # Reply to an existing thread (preserves threading via In-Reply-To and References headers)
  python3 scripts/gmail.py reply --to "user@example.com" --subject "Re: Subject" --body "Reply body" --message-id "<original-message-id>"

  # Read recent emails from your inbox
  python3 scripts/gmail.py read [--days 30] [--from "filter@example.com"] [--unread-only]

  # Search emails using IMAP search syntax
  python3 scripts/gmail.py search --query "from:someone@example.com"

Outlook / Microsoft 365 mailboxes are the one exception to the SMTP+IMAP
approach: Microsoft retired app-password access, so those accounts connect
over OAuth instead. Set EMAIL_AUTH=oauth-microsoft in .env (the wizard does this
when you pick Outlook) and run `python3 scripts/ms_oauth.py login` once —
every command below then transparently uses the Microsoft Graph backend
(scripts/mail_graph.py) with the same arguments and output. EMAIL_PASSWORD /
SMTP / IMAP / folder settings are ignored in that mode.

Required .env config (password/IMAP mode — every provider except Outlook):
  EMAIL_ADDRESS=you@example.com
  EMAIL_PASSWORD=app_specific_password    # Use an "app password" not your real password
  EMAIL_SMTP_HOST=smtp.example.com
  EMAIL_SMTP_PORT=587                     # 587 for STARTTLS, 465 for SSL
  EMAIL_IMAP_HOST=imap.example.com
  EMAIL_IMAP_PORT=993
  EMAIL_FROM_NAME=Your Name               # Display name shown in "From" header
  EMAIL_SENT_FOLDER=Sent                  # Provider-specific. Gmail: "[Gmail]/Sent Mail". Outlook/IONOS: "Sent Items". Most others: "Sent"
  EMAIL_INBOX_FOLDER=INBOX                # Usually INBOX. Gmail users can set to "[Gmail]/All Mail" to also see archived
  EMAIL_DRAFTS_FOLDER=Drafts              # Only used by `draft`. Gmail: "[Gmail]/Drafts". Most others: "Drafts"

Common provider settings:
  Gmail:       SMTP smtp.gmail.com:587, IMAP imap.gmail.com:993, sent="[Gmail]/Sent Mail", inbox=INBOX
  Outlook:     SMTP smtp-mail.outlook.com:587, IMAP outlook.office365.com:993, sent="Sent Items", inbox=INBOX
  IONOS UK:    SMTP smtp.ionos.co.uk:587, IMAP imap.ionos.co.uk:993, sent="Sent Items", inbox=INBOX
  Fastmail:    SMTP smtp.fastmail.com:587, IMAP imap.fastmail.com:993, sent="Sent", inbox=INBOX
  Zoho:        SMTP smtp.zoho.com:587, IMAP imap.zoho.com:993, sent="Sent", inbox=INBOX
"""

# Make Python's ssl module trust the OS root-CA store before imaplib/smtplib
# negotiate TLS. Without this, Windows machines whose antivirus / corporate-
# proxy MITMs HTTPS-and-friends hit cert-verification failures on every IMAP
# fetch and SMTP send. No-op on systems without interception. Guarded so
# older Klaudius setups (pre-0.7.1, no truststore in pip install list) still
# run — they just keep using certifi's bundled list.
try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

import argparse
import email
import imaplib
import mimetypes
import os
import random
import re
import smtplib
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate, make_msgid
from pathlib import Path

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


# Load .env file
def load_env():
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                value = value.strip()
                # Strip matching surrounding quotes, as dotenv does — and as
                # sibling scripts (check-live-auth.py, check-dns-auth.js)
                # already did. The wizard QUOTES any value containing spaces
                # or shell metacharacters, and a Google app password is
                # presented as four space-separated groups ("abcd efgh ijkl
                # mnop"), so pasting it as shown wrote a quoted value that
                # this loader then handed to the SMTP server with the quotes
                # still attached. The server rejects it, and the failure reads
                # as a wrong password rather than a quoting artefact.
                if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                    value = value[1:-1]
                os.environ.setdefault(key.strip(), value)

load_env()


def _use_graph():
    """True when this install's mailbox is Outlook / Microsoft 365 connected
    over OAuth (EMAIL_AUTH=oauth-microsoft in .env). Every public function in
    this module dispatches to scripts/mail_graph.py in that mode — same
    signatures, same return shapes, same printed output — so callers (skills,
    sync_thread_state.py, this file's CLI) never need to know which backend is
    live. The password/IMAP path below is untouched when this returns False.
    """
    return os.environ.get("EMAIL_AUTH", "").strip().lower() == "oauth-microsoft"


def _graph():
    # Lazy import: only Outlook-mode installs need mail_graph (and its
    # `requests` dependency); password-mode installs never touch it.
    import mail_graph
    return mail_graph


def get_config():
    """Load email configuration from environment. Exits with a clear error if anything required is missing."""
    address = os.environ.get("EMAIL_ADDRESS", "").strip()
    password = os.environ.get("EMAIL_PASSWORD", "").strip()

    if not address or not password:
        print("ERROR: EMAIL_ADDRESS and EMAIL_PASSWORD must be set in .env", file=sys.stderr)
        print("See the docstring at the top of scripts/gmail.py for common provider settings.", file=sys.stderr)
        sys.exit(1)

    smtp_host = os.environ.get("EMAIL_SMTP_HOST", "").strip()
    imap_host = os.environ.get("EMAIL_IMAP_HOST", "").strip()
    if not smtp_host or not imap_host:
        print("ERROR: EMAIL_SMTP_HOST and EMAIL_IMAP_HOST must be set in .env", file=sys.stderr)
        sys.exit(1)

    from_name = os.environ.get("EMAIL_FROM_NAME", "").strip() or address
    domain = address.split("@", 1)[1] if "@" in address else "localhost"

    sent_folder = os.environ.get("EMAIL_SENT_FOLDER", "Sent").strip()
    inbox_folder = os.environ.get("EMAIL_INBOX_FOLDER", "INBOX").strip()
    drafts_folder = os.environ.get("EMAIL_DRAFTS_FOLDER", "Drafts").strip()

    # IMAP folder names with spaces or special chars need to be quoted
    if " " in sent_folder and not sent_folder.startswith('"'):
        sent_folder = f'"{sent_folder}"'
    if " " in inbox_folder and not inbox_folder.startswith('"'):
        inbox_folder = f'"{inbox_folder}"'
    if " " in drafts_folder and not drafts_folder.startswith('"'):
        drafts_folder = f'"{drafts_folder}"'

    return {
        "address": address,
        "password": password,
        "smtp_host": smtp_host,
        "smtp_port": int(os.environ.get("EMAIL_SMTP_PORT", "587")),
        "imap_host": imap_host,
        "imap_port": int(os.environ.get("EMAIL_IMAP_PORT", "993")),
        "from_header": f"{from_name} <{address}>",
        "domain": domain,
        "sent_folder": sent_folder,
        "inbox_folder": inbox_folder,
        "drafts_folder": drafts_folder,
    }


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
    any broken URLs. Empty list = all OK.

    Uses urllib rather than a curl subprocess: no dependency on curl being on PATH,
    and it goes through Python's OS-CA-trusting ssl context (truststore, injected at
    import) which is more reliable on MITM'd corporate/Windows networks. Redirects
    are followed (urllib's default), matching "does this link load for the client" —
    a URL that 30x-redirects to a live page passes. Mirrors twilio_sms.py."""
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


def fetch_message_by_id(message_id: str):
    """Look up a specific message in the Sent folder by its Message-ID header.

    Returns a dict with keys {message_id, date, from, subject, body, references}
    or None if not found. Used by `reply` to auto-append the prior message's
    body as a quoted block so the recipient sees the full thread inline.
    """
    if _use_graph():
        return _graph().fetch_message_by_id(message_id)
    config = get_config()
    try:
        mail = imaplib.IMAP4_SSL(config["imap_host"], config["imap_port"])
        mail.login(config["address"], config["password"])
        mail.select(config["sent_folder"], readonly=True)
        search_id = message_id.strip()
        if not (search_id.startswith("<") and search_id.endswith(">")):
            search_id = f"<{search_id.strip('<>')}>"
        _, ids = mail.search(None, f'HEADER Message-ID "{search_id}"')
        id_list = ids[0].split()
        if not id_list:
            mail.logout()
            return None
        _, data = mail.fetch(id_list[-1], "(BODY.PEEK[])")
        msg = email.message_from_bytes(data[0][1])
        body = ""
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/plain":
                    body = part.get_payload(decode=True).decode("utf-8", errors="replace")
                    break
        else:
            payload = msg.get_payload(decode=True)
            if payload:
                body = payload.decode("utf-8", errors="replace")
        mail.logout()
        return {
            "message_id": msg["Message-ID"],
            "date": msg["Date"],
            "from": msg["From"],
            "subject": msg["Subject"],
            "body": body,
            "references": msg["References"],
        }
    except Exception as exc:
        print(f"WARNING: fetch_message_by_id failed: {exc}", file=sys.stderr)
        return None


def find_thread_recipient_by_message_id(message_id: str):
    """Search the Sent folder for a message with this Message-ID.

    Returns the `To:` address of the matching message, or None. Used by the
    `reply` handler to detect mailbox-mismatch threading bugs: if you're
    replying TO address A, but the original chain was sent TO address B, then
    the recipient's mail client at A won't have the prior Message-IDs in its
    index and threading will fail on their side regardless of how perfectly
    we set our In-Reply-To/References headers. The fix is to Cc address B so
    the thread stays intact at the mailbox where it actually lives.
    """
    if _use_graph():
        return _graph().find_thread_recipient_by_message_id(message_id)
    config = get_config()
    try:
        mail = imaplib.IMAP4_SSL(config["imap_host"], config["imap_port"])
        mail.login(config["address"], config["password"])
        mail.select(config["sent_folder"], readonly=True)
        search_id = message_id.strip()
        if not (search_id.startswith("<") and search_id.endswith(">")):
            search_id = f"<{search_id.strip('<>')}>"
        _, ids = mail.search(None, f'HEADER Message-ID "{search_id}"')
        id_list = ids[0].split()
        if not id_list:
            mail.logout()
            return None
        _, data = mail.fetch(id_list[-1], "(BODY.PEEK[])")
        msg = email.message_from_bytes(data[0][1])
        to_header = msg.get("To") or ""
        mail.logout()
        # Strip "Display Name <addr>" → addr
        match = re.search(r"<([^>]+)>", to_header)
        if match:
            return match.group(1).strip().lower()
        return to_header.strip().lower() or None
    except Exception as exc:
        print(f"WARNING: find_thread_recipient_by_message_id failed: {exc}", file=sys.stderr)
        return None


def find_latest_in_thread(to: str, subject: str):
    """Find the most recent message in the Sent folder to a given recipient
    with a matching Subject (ignoring Re: prefixes).

    Used by `reply` so the new email's In-Reply-To + References always point
    at the latest message in the thread, not just whatever --message-id was
    passed in. Makes threading robust even when the caller only knows the
    original outreach's Message-ID.
    """
    if _use_graph():
        return _graph().find_latest_in_thread(to, subject)
    config = get_config()
    try:
        mail = imaplib.IMAP4_SSL(config["imap_host"], config["imap_port"])
        mail.login(config["address"], config["password"])
        mail.select(config["sent_folder"], readonly=True)
        _, ids = mail.search(None, f'TO "{to}"')
        id_list = ids[0].split()
        base_subject = re.sub(r"^\s*(Re:\s*)+", "", subject, flags=re.IGNORECASE).strip().lower()
        latest = None
        latest_ts = None
        for i in reversed(id_list):
            _, data = mail.fetch(i, "(BODY.PEEK[])")
            msg = email.message_from_bytes(data[0][1])
            msg_subject = msg["Subject"] or ""
            msg_base = re.sub(r"^\s*(Re:\s*)+", "", msg_subject, flags=re.IGNORECASE).strip().lower()
            if msg_base != base_subject:
                continue
            ts = None
            try:
                from email.utils import parsedate_to_datetime
                ts = parsedate_to_datetime(msg["Date"])
            except Exception:
                pass
            if latest is None or (ts and latest_ts and ts > latest_ts):
                body = ""
                if msg.is_multipart():
                    for part in msg.walk():
                        if part.get_content_type() == "text/plain":
                            body = part.get_payload(decode=True).decode("utf-8", errors="replace")
                            break
                else:
                    payload = msg.get_payload(decode=True)
                    if payload:
                        body = payload.decode("utf-8", errors="replace")
                latest = {
                    "message_id": msg["Message-ID"],
                    "date": msg["Date"],
                    "from": msg["From"],
                    "subject": msg["Subject"],
                    "body": body,
                    "references": msg["References"],
                }
                latest_ts = ts
        mail.logout()
        return latest
    except Exception as exc:
        print(f"WARNING: find_latest_in_thread failed: {exc}", file=sys.stderr)
        return None


def build_quoted_reply(body: str, prior: dict) -> str:
    """Append prior message's body as a one-level quoted block beneath the new body.

    Each subsequent reply adds one more level of `>` indentation, so the chain
    naturally nests to the full depth of the conversation. Matches the format
    produced by Gmail, Outlook, Apple Mail when you hit Reply on a thread.
    """
    if not prior or not prior.get("body"):
        return body
    prior_body = prior["body"].rstrip()
    quoted_lines = []
    for line in prior_body.splitlines():
        if line == "":
            quoted_lines.append(">")
        else:
            quoted_lines.append(f"> {line}")
    quoted = "\n".join(quoted_lines)
    sender = prior.get("from") or "the sender"
    date = prior.get("date") or ""
    return f"{body.rstrip()}\n\nOn {date}, {sender} wrote:\n{quoted}\n"


def send_email(to, subject, body, reply_to_message_id=None, references=None, cc=None,
               verify_urls=True):
    """Send an email via SMTP. Supports threading via In-Reply-To header.

    `cc` is an optional list of email addresses. They get a Cc header AND are
    added to the SMTP envelope recipients. Used by `reply` to keep the
    original-mailbox copied when the human replied from a different address —
    so threading on the original mailbox stays intact.

    `verify_urls=False` (the `--no-url-check` flag) skips the deployed-URL
    liveness gate. That gate exists so a CLIENT never receives a dead link;
    operator ALERTS routed through this script (scripts/notify.sh with
    NOTIFY_CHANNEL=email) are often *about* a dead URL, and blocking those
    would swallow exactly the alert that matters most.
    """
    if _use_graph():
        return _graph().send_email(to, subject, body,
                                   reply_to_message_id=reply_to_message_id,
                                   references=references, cc=cc,
                                   verify_urls=verify_urls)
    if verify_urls:
        # Verify all deployed-site URLs in the message are live before sending
        url_errors = verify_urls_in_message(body)
        if url_errors:
            print(f"BLOCKED: Message contains broken URLs:", file=sys.stderr)
            for err in url_errors:
                print(f"  - {err}", file=sys.stderr)
            print("Fix the deployment before sending.", file=sys.stderr)
            return None

    config = get_config()

    cc_clean = [c.strip() for c in (cc or []) if c and c.strip()]

    msg = MIMEText(body, "plain")
    msg["From"] = config["from_header"]
    msg["To"] = to
    if cc_clean:
        msg["Cc"] = ", ".join(cc_clean)
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=config["domain"])
    msg["Reply-To"] = config["address"]
    msg["List-Unsubscribe"] = f"<mailto:{config['address']}?subject=unsubscribe>"
    msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"

    # Threading headers - makes replies appear in the same thread
    if reply_to_message_id:
        msg["In-Reply-To"] = reply_to_message_id
        msg["References"] = references or reply_to_message_id

    envelope_recipients = [to] + cc_clean

    # Port 465 is implicit SSL (SMTP_SSL from the first byte); 587/25 are
    # plaintext + STARTTLS. Calling starttls() against a 465 socket hangs
    # with no useful error, and several providers (Zoho, Yahoo) steer users
    # to 465, so branch on the port. The 30s timeout turns any remaining
    # port/protocol mismatch into a visible error instead of a silent hang.
    if config["smtp_port"] == 465:
        server_ctx = smtplib.SMTP_SSL(config["smtp_host"], config["smtp_port"], timeout=30)
    else:
        server_ctx = smtplib.SMTP(config["smtp_host"], config["smtp_port"], timeout=30)
    with server_ctx as server:
        if config["smtp_port"] != 465:
            server.starttls()
        server.login(config["address"], config["password"])
        server.sendmail(config["address"], envelope_recipients, msg.as_string())

    # Save to IMAP Sent folder so it appears in webmail
    try:
        imap = imaplib.IMAP4_SSL(config["imap_host"], config["imap_port"])
        imap.login(config["address"], config["password"])
        imap.append(config["sent_folder"], "\\Seen", None, msg.as_bytes())
        imap.logout()
    except Exception:
        pass  # Non-critical, email was already sent

    print(f"Email sent to {to}")
    print(f"Subject: {subject}")
    print(f"Message-ID: {msg['Message-ID']}")

    # Rate limiting: random 15-30s delay to avoid bulk-sending patterns
    delay = random.uniform(15, 30)
    print(f"Rate limit: waiting {delay:.0f}s before next send...")
    time.sleep(delay)

    return msg["Message-ID"]


def check_attachment_paths(attachments):
    """Validate attachment paths before any mailbox work. Returns a list of
    error strings (empty = all fine). Shared by both mail backends so a bad
    path fails identically fast on IMAP and Graph installs."""
    errors = []
    for att in attachments or []:
        p = Path(att)
        if not p.is_file():
            errors.append(f"attachment not found: {att}")
        elif p.stat().st_size == 0:
            errors.append(f"attachment is empty: {att}")
        elif p.stat().st_size > 25 * 1024 * 1024:
            errors.append(f"attachment exceeds 25MB (most providers reject it): {att}")
    return errors


def build_attachment_part(path_str):
    """One file → a MIME part with the right content type and a filename."""
    p = Path(path_str)
    ctype, _ = mimetypes.guess_type(p.name)
    maintype, _, subtype = (ctype or "application/octet-stream").partition("/")
    part = MIMEBase(maintype, subtype)
    part.set_payload(p.read_bytes())
    encoders.encode_base64(part)
    part.add_header("Content-Disposition", "attachment", filename=p.name)
    return part


def draft_email(to, subject, body, attachments=None):
    """Save an outreach email to the IMAP Drafts folder WITHOUT sending it.

    Used by manual-approval mode (OUTREACH_ENABLED=false, or an explicit
    "draft but don't send" request) and by /send-invoice (which passes
    `attachments` — file paths attached to the draft): the operator gets a
    ready-to-send message sitting in their mail client's Drafts, reviews it,
    and hits send themselves. Builds the same MIME message `send_email` would
    (minus threading headers) and IMAP-APPENDs it to the Drafts folder with
    the \\Draft flag. Nothing leaves the outbox — there is no SMTP send here.
    """
    if _use_graph():
        return _graph().draft_email(to, subject, body, attachments=attachments)
    config = get_config()

    att_errors = check_attachment_paths(attachments)
    if att_errors:
        for err in att_errors:
            print(f"ERROR: {err}", file=sys.stderr)
        return None

    # Verify deployed-site URLs resolve, but only WARN (don't block): the whole
    # point of a draft is human review, and the operator can fix a URL before
    # sending. (send_email hard-blocks on broken URLs; a draft shouldn't.)
    url_errors = verify_urls_in_message(body)
    if url_errors:
        print("WARNING: draft contains URLs that did not return HTTP 200:", file=sys.stderr)
        for err in url_errors:
            print(f"  - {err}", file=sys.stderr)

    if attachments:
        msg = MIMEMultipart()
        msg.attach(MIMEText(body, "plain"))
        for att in attachments:
            msg.attach(build_attachment_part(att))
    else:
        msg = MIMEText(body, "plain")
    msg["From"] = config["from_header"]
    msg["To"] = to
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=config["domain"])
    msg["Reply-To"] = config["address"]
    if not attachments:
        # Outreach drafts keep the marketing-list headers their eventual send
        # would carry. Attachment drafts are transactional (invoices) — a
        # List-Unsubscribe header there makes Gmail render an "Unsubscribe"
        # link next to a bill.
        msg["List-Unsubscribe"] = f"<mailto:{config['address']}?subject=unsubscribe>"
        msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"

    try:
        imap = imaplib.IMAP4_SSL(config["imap_host"], config["imap_port"])
        imap.login(config["address"], config["password"])
        status, resp = imap.append(config["drafts_folder"], "\\Draft", None, msg.as_bytes())
        imap.logout()
    except Exception as exc:
        print(f"ERROR: could not save draft to {config['drafts_folder']}: {exc}", file=sys.stderr)
        print("Set EMAIL_DRAFTS_FOLDER in .env to your provider's drafts folder "
              '(Gmail: "[Gmail]/Drafts"; most others: "Drafts").', file=sys.stderr)
        return None

    if status != "OK":
        print(f"ERROR: IMAP APPEND to {config['drafts_folder']} returned {status}: {resp}", file=sys.stderr)
        print("Check EMAIL_DRAFTS_FOLDER in .env matches your provider's drafts folder name.", file=sys.stderr)
        return None

    print(f"Draft saved to {config['drafts_folder']} (NOT sent)")
    print(f"To: {to}")
    print(f"Subject: {subject}")
    for att in attachments or []:
        print(f"Attached: {Path(att).name}")
    print("Note: your mail client assigns the final Message-ID and Date when you send "
          "this draft, so do NOT store this draft as outreach_message_id.")
    # True/None (never a Message-ID — see the note above): callers only need
    # pass/fail, and the CLI uses it to exit non-zero on a failed
    # draft-with-attachment.
    return True


def read_emails(days=30, from_filter=None, unread_only=False, max_results=50):
    """Read recent emails from your configured inbox folder via IMAP."""
    if _use_graph():
        return _graph().read_emails(days=days, from_filter=from_filter,
                                    unread_only=unread_only, max_results=max_results)
    config = get_config()

    mail = imaplib.IMAP4_SSL(config["imap_host"], config["imap_port"])
    mail.login(config["address"], config["password"])
    # readonly (EXAMINE) select: reading must never mutate the mailbox. The
    # fetches below use BODY.PEEK[] for the same reason — a plain RFC822 fetch
    # sets \Seen, marking the operator's mail read as a side effect (and making
    # unread_only self-defeating across runs). The Graph backend already reads
    # without marking; this keeps IMAP in parity.
    mail.select(config["inbox_folder"], readonly=True)

    # Build search criteria
    since_date = (datetime.now() - timedelta(days=days)).strftime("%d-%b-%Y")
    criteria = [f'SINCE {since_date}']

    if from_filter:
        criteria.append(f'(OR FROM "{from_filter}" TO "{from_filter}")')

    if unread_only:
        criteria.append("UNSEEN")

    search_str = " ".join(criteria)
    _, message_ids = mail.search(None, search_str)

    ids = message_ids[0].split()
    if not ids:
        print("No emails found matching criteria.")
        mail.logout()
        return []

    # Get most recent N
    ids = ids[-max_results:]
    results = []

    for mid in ids:
        _, msg_data = mail.fetch(mid, "(BODY.PEEK[])")
        raw = msg_data[0][1]
        msg = email.message_from_bytes(raw)

        # Decode subject
        subject_header = email.header.decode_header(msg["Subject"] or "")
        subject = ""
        for part, charset in subject_header:
            if isinstance(part, bytes):
                subject += part.decode(charset or "utf-8", errors="replace")
            else:
                subject += part

        # Get body
        body = ""
        if msg.is_multipart():
            html_body = ""
            for part in msg.walk():
                ct = part.get_content_type()
                if ct == "text/plain":
                    payload = part.get_payload(decode=True)
                    if payload:
                        body = payload.decode("utf-8", errors="replace")
                        break
                elif ct == "text/html" and not html_body:
                    payload = part.get_payload(decode=True)
                    if payload:
                        html_body = payload.decode("utf-8", errors="replace")
            if not body and html_body:
                body = re.sub(r'<[^>]+>', '', html_body)
                body = re.sub(r'\s+', ' ', body).strip()
        else:
            payload = msg.get_payload(decode=True)
            if payload:
                body = payload.decode("utf-8", errors="replace")

        result = {
            "message_id": msg["Message-ID"],
            "from": msg["From"],
            "to": msg["To"],
            "subject": subject,
            "date": msg["Date"],
            "body": body.strip(),
            "in_reply_to": msg.get("In-Reply-To"),
            "references": msg.get("References"),
        }
        results.append(result)

    mail.logout()
    return results


def search_emails(query, max_results=20):
    """Search emails using IMAP search syntax across both INBOX and Sent folders.
    Plain text queries are automatically wrapped in TEXT "..." for convenience."""
    if _use_graph():
        return _graph().search_emails(query, max_results=max_results)
    # If query doesn't start with an IMAP search key, wrap it as a TEXT search
    imap_keys = ("SUBJECT", "FROM", "TO", "TEXT", "BODY", "CC", "BCC",
                 "BEFORE", "SINCE", "ON", "ALL", "UNSEEN", "SEEN", "FLAGGED")
    if not any(query.strip().upper().startswith(k) for k in imap_keys):
        query = f'TEXT "{query}"'

    config = get_config()

    mail = imaplib.IMAP4_SSL(config["imap_host"], config["imap_port"])
    mail.login(config["address"], config["password"])

    # Search both inbox and sent folders, dedup by Message-ID
    folders = [config["inbox_folder"], config["sent_folder"]]

    results = []
    seen_message_ids = set()

    for folder in folders:
        try:
            mail.select(folder, readonly=True)
        except Exception as exc:
            print(f"WARNING: could not select folder {folder}: {exc}", file=sys.stderr)
            continue
        _, message_ids = mail.search(None, query)
        ids = message_ids[0].split()
        if not ids:
            continue
        for mid in ids[-max_results:]:
            _, msg_data = mail.fetch(mid, "(BODY.PEEK[])")
            raw = msg_data[0][1]
            msg = email.message_from_bytes(raw)
            # Dedup by Message-ID across folders
            msg_id = msg.get("Message-ID", "")
            if msg_id and msg_id in seen_message_ids:
                continue
            if msg_id:
                seen_message_ids.add(msg_id)

            subject_header = email.header.decode_header(msg["Subject"] or "")
            subject = ""
            for part, charset in subject_header:
                if isinstance(part, bytes):
                    subject += part.decode(charset or "utf-8", errors="replace")
                else:
                    subject += part

            body = ""
            if msg.is_multipart():
                html_body = ""
                for part in msg.walk():
                    ct = part.get_content_type()
                    if ct == "text/plain":
                        payload = part.get_payload(decode=True)
                        if payload:
                            body = payload.decode("utf-8", errors="replace")
                            break
                    elif ct == "text/html" and not html_body:
                        payload = part.get_payload(decode=True)
                        if payload:
                            html_body = payload.decode("utf-8", errors="replace")
                if not body and html_body:
                    body = re.sub(r'<[^>]+>', '', html_body)
                    body = re.sub(r'\s+', ' ', body).strip()
            else:
                payload = msg.get_payload(decode=True)
                if payload:
                    body = payload.decode("utf-8", errors="replace")

            result = {
                "message_id": msg["Message-ID"],
                "from": msg["From"],
                "to": msg["To"],
                "subject": subject,
                "date": msg["Date"],
                "body": body.strip(),
            }
            results.append(result)

    if not results:
        print("No emails found.")

    mail.logout()
    return results


def format_email(e):
    """Format an email for display."""
    lines = [
        f"{'='*70}",
        f"From:    {e['from']}",
        f"To:      {e['to']}",
        f"Date:    {e['date']}",
        f"Subject: {e['subject']}",
        f"Msg-ID:  {e.get('message_id', 'N/A')}",
        f"{'-'*70}",
        e["body"][:2000] if e["body"] else "(no body)",
        "",
    ]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Generic email send/read client (SMTP + IMAP)")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Send
    send_parser = subparsers.add_parser("send", help="Send a new email")
    send_parser.add_argument("--to", required=True)
    send_parser.add_argument("--subject", required=True)
    send_parser.add_argument("--body", required=True)
    send_parser.add_argument("--no-url-check", action="store_true",
                             help="Skip the deployed-URL liveness gate (operator alerts only — "
                                  "never for client outreach)")

    # Draft (save to Drafts, do NOT send)
    draft_parser = subparsers.add_parser("draft", help="Save an email to Drafts without sending (manual-approval mode)")
    draft_parser.add_argument("--to", required=True)
    draft_parser.add_argument("--subject", required=True)
    draft_parser.add_argument("--body", required=True)
    draft_parser.add_argument("--attach", action="append", default=[], metavar="FILE",
                              help="File to attach to the draft (repeatable). Draft-only: "
                                   "send/reply have no attachment path by design.")

    # Reply
    reply_parser = subparsers.add_parser("reply", help="Reply to an existing thread")
    reply_parser.add_argument("--to", required=True)
    reply_parser.add_argument("--subject", required=True)
    reply_parser.add_argument("--body", required=True)
    reply_parser.add_argument("--message-id", required=True, help="Message-ID of the email to reply to")
    reply_parser.add_argument("--references", help="References header for threading")
    reply_parser.add_argument("--cc", help="Comma-separated CC list (in addition to any auto-detected mailbox-mismatch CC)")
    reply_parser.add_argument("--accept-orphan", action="store_true",
                             help="Send the reply even if no prior thread exists at the recipient's mailbox AND no original-mailbox could be auto-detected from the references chain. Without this flag, orphan replies abort with an error.")

    # Read
    read_parser = subparsers.add_parser("read", help="Read recent emails")
    read_parser.add_argument("--days", type=int, default=30)
    read_parser.add_argument("--from", dest="from_filter")
    read_parser.add_argument("--unread-only", action="store_true")
    read_parser.add_argument("--max", type=int, default=50)

    # Search
    search_parser = subparsers.add_parser("search", help="Search emails")
    search_parser.add_argument("--query", required=True, help='IMAP search query, e.g. FROM "user@example.com"')
    search_parser.add_argument("--max", type=int, default=20)

    args = parser.parse_args()

    if args.command == "send":
        send_email(args.to, args.subject, args.body, verify_urls=not args.no_url_check)

    elif args.command == "draft":
        if draft_email(args.to, args.subject, args.body, attachments=args.attach) is None and args.attach:
            # A failed draft with attachments must fail loudly: /send-invoice
            # checks the exit code before telling the operator "it's in your
            # Drafts". (Plain drafts keep the old always-zero behaviour.)
            sys.exit(1)

    elif args.command == "reply":
        latest = find_latest_in_thread(args.to, args.subject)
        prior = latest or fetch_message_by_id(args.message_id)
        effective_message_id = (prior and prior.get("message_id")) or args.message_id
        body = build_quoted_reply(args.body, prior) if prior else args.body
        references = args.references
        if not references and prior:
            prior_refs = (prior.get("references") or "").strip()
            prior_id = (prior.get("message_id") or args.message_id).strip()
            references = f"{prior_refs} {prior_id}".strip() if prior_refs else prior_id

        # Build CC list: explicit --cc plus auto-detected mailbox-mismatch CC.
        cc_addresses = []
        if args.cc:
            cc_addresses.extend([c.strip() for c in args.cc.split(",") if c.strip()])

        # Mailbox-mismatch detection: when find_latest_in_thread returns nothing,
        # the recipient's mailbox has no prior thread for us. If the references
        # chain points back to a DIFFERENT address that we have sent to before,
        # the original chain lives there — Cc that address so threading on the
        # recipient's side stays intact. (Fixes the case where outreach was sent
        # to contact@business.com, owner replied from owner@gmail.com, and our
        # reply to Gmail orphans because Gmail's index has never seen the prior
        # Message-IDs.)
        auto_cc_added = []
        if latest is None and references:
            ref_ids = re.findall(r"<[^>]+>", references)
            seen = set()
            to_lower = args.to.strip().lower()
            existing_cc_lower = {c.lower() for c in cc_addresses}
            for ref_id in ref_ids:
                prev_to = find_thread_recipient_by_message_id(ref_id)
                if not prev_to or prev_to in seen:
                    continue
                seen.add(prev_to)
                if prev_to == to_lower or prev_to in existing_cc_lower:
                    continue
                cc_addresses.append(prev_to)
                existing_cc_lower.add(prev_to)
                auto_cc_added.append(prev_to)

        if auto_cc_added:
            print(
                f"WARNING: mailbox-mismatch detected — the recipient ({args.to}) has no prior "
                f"thread at this address, but the references chain points to "
                f"{', '.join(auto_cc_added)}. Auto-Cc-ing so threading stays intact at the "
                f"original mailbox.",
                file=sys.stderr,
            )

        if prior is None:
            print(
                f"WARNING: no prior message found for thread at {args.to}, sending without inline quoted thread",
                file=sys.stderr,
            )

        # Orphan guard: if we found nothing at all (no prior thread at this
        # recipient by subject, no matching Message-ID in our Sent folder) AND
        # auto-Cc discovered no related mailbox, the reply is genuinely
        # standalone on the recipient's side. Refuse to send unless the caller
        # explicitly opts in. We use `prior is None` (not `latest is None`) so
        # that legitimate follow-ups with a valid --message-id but mismatched
        # subject still go through.
        if prior is None and not auto_cc_added and not args.cc and not args.accept_orphan:
            print(
                "ERROR: orphan reply detected — no prior thread at recipient mailbox and "
                "no related mailbox could be auto-detected from --references. Pass "
                "--accept-orphan to send anyway, or pass --cc to add a related address.",
                file=sys.stderr,
            )
            sys.exit(2)

        send_email(args.to, args.subject, body,
                   reply_to_message_id=effective_message_id,
                   references=references,
                   cc=cc_addresses)

    elif args.command == "read":
        emails = read_emails(days=args.days, from_filter=args.from_filter,
                             unread_only=args.unread_only, max_results=args.max)
        for e in emails:
            print(format_email(e))
        print(f"\nTotal: {len(emails)} emails")

    elif args.command == "search":
        emails = search_emails(args.query, max_results=args.max)
        for e in emails:
            print(format_email(e))
        print(f"\nTotal: {len(emails)} emails")


if __name__ == "__main__":
    main()
