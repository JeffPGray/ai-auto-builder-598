#!/usr/bin/env python3
"""
mail_graph.py - Microsoft Graph mail backend for Outlook / Microsoft 365 mailboxes.

The OAuth twin of gmail.py's IMAP/SMTP internals, used when
`EMAIL_AUTH=oauth-microsoft` is set in .env. Never invoked directly — gmail.py
dispatches here from each of its public functions, so every caller (the
outreach/follow-up skills, sync_thread_state.py, the gmail.py CLI) keeps its
existing interface and return shapes.

Why Graph rather than IMAP/SMTP-with-OAuth: Microsoft retired basic auth for
IMAP years ago and is retiring SMTP AUTH entirely (default-off end of 2026);
IMAP/SMTP also stay gated behind per-mailbox admin toggles that Graph does not
need. Graph is the one Microsoft mail path that works on a stock tenant with
nothing but the user's own consent.

Fidelity notes:
  - SENDS go through Graph's raw-MIME endpoint, not its JSON message shape.
    We build the exact same MIMEText message gmail.py builds — same
    Message-ID, In-Reply-To/References threading, Reply-To, List-Unsubscribe —
    and hand Graph the bytes. (Graph's JSON API rejects custom non-`x-`
    headers, which would silently break threading.)
  - Exchange usually preserves our Message-ID on MIME sends; because
    outreach_message_id in Supabase must match what recipients actually see,
    send_email verifies against Sent Items after sending and reports the
    authoritative id.
  - Sent mail lands in Sent Items automatically (no IMAP APPEND needed);
    reads come from the mailbox's well-known folders, so EMAIL_*_FOLDER
    settings are ignored in this mode.
  - Graph's $search (used for to:/from: thread lookups) is served by Exchange's
    search index, which can lag a few seconds behind a send. Fine for
    follow-up/warm-leads cadence work (hours later); don't build anything that
    sends and immediately expects to find the message via search.
"""

import base64
import email
import email.header
import os
import random
import re
import sys

# Windows stdout/stderr default to cp1252, and this module prints
# client-authored email text (bodies, subjects) — emoji in it would die with
# UnicodeEncodeError. Today this is belt-and-braces: gmail.py is the sole
# entry point (it lazy-imports this module into a process whose streams its
# own identical block has already reconfigured), so this only fires if that
# arrangement ever erodes or someone runs this file directly. Outlook
# operators skew Windows, so the eroded case would bite hardest here.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
import time
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from email.utils import format_datetime, formatdate, make_msgid, parsedate_to_datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ms_oauth import MsAuthError, get_account, graph_request  # noqa: E402
# gmail.py only imports mail_graph lazily inside function bodies, so this
# top-level import back into gmail is cycle-safe.
from gmail import verify_urls_in_message  # noqa: E402

# Well-known folder names — stable API identifiers, independent of the
# mailbox's display language (a German mailbox's "Gesendete Elemente" is still
# `sentitems`). This is why EMAIL_SENT_FOLDER/EMAIL_INBOX_FOLDER don't apply here.
FOLDER_INBOX = "inbox"
FOLDER_SENT = "sentitems"
FOLDER_DRAFTS = "drafts"
FOLDER_JUNK = "junkemail"

# Ask Graph to render message bodies as plain text on JSON reads.
_TEXT_BODY_HEADER = {"Prefer": 'outlook.body-content-type="text"'}


def get_config():
    """Address/name config for the Graph path. No passwords, no hosts.

    Prefers the actually-signed-in account's address over EMAIL_ADDRESS when
    they differ (ms_oauth warns loudly about the mismatch at login) — sends
    can only ever go out as the signed-in mailbox, so pretending otherwise
    would stamp a From header Exchange then overrides.
    """
    env_address = os.environ.get("EMAIL_ADDRESS", "").strip()
    acct = get_account() or {}
    address = (acct.get("address") or env_address).strip()
    if not address:
        print(
            "ERROR: no signed-in Microsoft account and no EMAIL_ADDRESS in .env. "
            "Run `python3 scripts/ms_oauth.py login`.",
            file=sys.stderr,
        )
        sys.exit(1)
    from_name = os.environ.get("EMAIL_FROM_NAME", "").strip() or address
    return {
        "address": address,
        "from_header": f"{from_name} <{address}>",
        "domain": address.split("@", 1)[1] if "@" in address else "localhost",
    }


# ---------------------------------------------------------------------------
# MIME helpers (mirror gmail.py's message shapes exactly)
# ---------------------------------------------------------------------------

def _build_mime(config, to, subject, body, reply_to_message_id=None, references=None, cc=None):
    msg = MIMEText(body, "plain")
    msg["From"] = config["from_header"]
    msg["To"] = to
    if cc:
        msg["Cc"] = ", ".join(cc)
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=config["domain"])
    msg["Reply-To"] = config["address"]
    msg["List-Unsubscribe"] = f"<mailto:{config['address']}?subject=unsubscribe>"
    msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    if reply_to_message_id:
        msg["In-Reply-To"] = reply_to_message_id
        msg["References"] = references or reply_to_message_id
    return msg


def _decode_subject(msg):
    subject = ""
    for part, charset in email.header.decode_header(msg["Subject"] or ""):
        if isinstance(part, bytes):
            subject += part.decode(charset or "utf-8", errors="replace")
        else:
            subject += part
    return subject


def _extract_body(msg):
    """text/plain first, stripped text/html as fallback — same as gmail.py."""
    if msg.is_multipart():
        html_body = ""
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == "text/plain":
                payload = part.get_payload(decode=True)
                if payload:
                    return payload.decode("utf-8", errors="replace")
            elif ct == "text/html" and not html_body:
                payload = part.get_payload(decode=True)
                if payload:
                    html_body = payload.decode("utf-8", errors="replace")
        if html_body:
            text = re.sub(r"<[^>]+>", "", html_body)
            return re.sub(r"\s+", " ", text).strip()
        return ""
    payload = msg.get_payload(decode=True)
    return payload.decode("utf-8", errors="replace") if payload else ""


def _parse_mime_bytes(raw):
    msg = email.message_from_bytes(raw)
    return {
        "message_id": msg["Message-ID"],
        "date": msg["Date"],
        "from": msg["From"],
        "to": msg["To"],
        "subject": _decode_subject(msg),
        "body": _extract_body(msg).strip(),
        "in_reply_to": msg.get("In-Reply-To"),
        "references": msg.get("References"),
    }


def _fetch_raw(graph_message_id):
    """Full RFC822 source of a message — lets the email module do the parsing,
    so header semantics (References, Message-ID, encoded subjects) match the
    IMAP path byte-for-byte."""
    resp = graph_request("GET", f"/me/messages/{graph_message_id}/$value")
    return resp.content


def _odata_quote(value):
    return value.replace("'", "''")


def _addr_header(recipients):
    """Graph recipient list → 'Name <addr>, Name <addr>' header string."""
    parts = []
    for r in recipients or []:
        ea = (r or {}).get("emailAddress") or {}
        name, addr = ea.get("name") or "", ea.get("address") or ""
        parts.append(f"{name} <{addr}>" if name and name != addr else addr)
    return ", ".join(p for p in parts if p)


def _rfc2822(iso_str):
    """Graph ISO-8601 timestamp → RFC 2822, so downstream
    parsedate_to_datetime() calls (sync_thread_state.py) keep working."""
    if not iso_str:
        return ""
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        return format_datetime(dt)
    except ValueError:
        return iso_str


def _sort_key(m):
    """Chronological sort key from a Graph message's raw ISO-8601 timestamp.

    Sorting on the RFC-2822 `date` string we hand back to callers would be
    wrong: "Fri, 31 Jul" sorts before "Mon, 03 Aug" lexicographically, so a
    result set spanning a month boundary comes out scrambled (and any
    [-max_results:] truncation then keeps the wrong messages). ISO-8601 UTC
    strings sort correctly as text, so key off those instead.
    """
    return m.get("receivedDateTime") or m.get("sentDateTime") or ""


def _json_message_to_dict(m):
    return {
        "message_id": m.get("internetMessageId"),
        "from": _addr_header([m.get("from")]) if m.get("from") else "",
        "to": _addr_header(m.get("toRecipients")),
        "subject": m.get("subject") or "",
        "date": _rfc2822(m.get("receivedDateTime") or m.get("sentDateTime")),
        "body": ((m.get("body") or {}).get("content") or "").strip(),
        # Threading headers aren't in Graph's JSON shape; reply flows get them
        # via fetch_message_by_id / find_latest_in_thread, which parse raw MIME.
        "in_reply_to": None,
        "references": None,
    }


def _find_by_internet_message_id(internet_message_id, folder=None):
    """Locate a message by its RFC Message-ID. Returns the JSON stub or None."""
    mid = internet_message_id.strip()
    if not (mid.startswith("<") and mid.endswith(">")):
        mid = f"<{mid.strip('<>')}>"
    base = f"/me/mailFolders/{folder}/messages" if folder else "/me/messages"
    resp = graph_request(
        "GET", base,
        params={
            "$filter": f"internetMessageId eq '{_odata_quote(mid)}'",
            "$select": "id,internetMessageId,subject,sentDateTime,receivedDateTime",
            "$top": "5",
        },
    )
    hits = resp.json().get("value", [])
    return hits[-1] if hits else None


def _search_folder(folder, kql, top=50, select="id,internetMessageId,subject,from,toRecipients,receivedDateTime,sentDateTime,isRead,body"):
    """$search a folder with a KQL query. Returns JSON message list."""
    # $search's value is itself a double-quoted string, so any quote INSIDE the
    # KQL (from _kql_value wrapping a multi-word term) must be backslash-
    # escaped or the whole expression is malformed. Verified against a live
    # tenant: the unescaped form returns 400 BadRequest "Syntax error", the
    # escaped form returns 200. Without this, /booking's mandatory email
    # verification step — `search --query 'SUBJECT "Klaudius Test"'` — fails
    # on every Outlook install, and since search no longer soft-fails that is
    # a hard abort rather than a shrug.
    escaped = kql.replace("\\", "\\\\").replace('"', '\\"')
    resp = graph_request(
        "GET", f"/me/mailFolders/{folder}/messages",
        params={"$search": f'"{escaped}"', "$select": select, "$top": str(min(top, 250))},
        headers=_TEXT_BODY_HEADER,
    )
    return resp.json().get("value", [])


# ---------------------------------------------------------------------------
# Public surface (parity with gmail.py)
# ---------------------------------------------------------------------------

def send_email(to, subject, body, reply_to_message_id=None, references=None, cc=None,
               verify_urls=True):
    """Send via Graph's raw-MIME endpoint. Returns the authoritative Message-ID
    (as recipients will see it) or None if blocked."""
    if verify_urls:
        url_errors = verify_urls_in_message(body)
        if url_errors:
            print("BLOCKED: Message contains broken URLs:", file=sys.stderr)
            for err in url_errors:
                print(f"  - {err}", file=sys.stderr)
            print("Fix the deployment before sending.", file=sys.stderr)
            return None

    config = get_config()
    cc_clean = [c.strip() for c in (cc or []) if c and c.strip()]
    msg = _build_mime(config, to, subject, body,
                      reply_to_message_id=reply_to_message_id,
                      references=references, cc=cc_clean)
    our_id = msg["Message-ID"]

    graph_request(
        "POST", "/me/sendMail",
        headers={"Content-Type": "text/plain"},
        data=base64.b64encode(msg.as_bytes()),
    )

    # Exchange occasionally rewrites the Message-ID on submission. The id we
    # store as outreach_message_id must be the one recipients' mail clients
    # will thread against, so read the sent copy back and prefer its header.
    #
    # EVERYTHING below is best-effort and must never raise: the mail has
    # already gone. If a throttled or failing Sent-Items lookup escaped from
    # here, gmail.py would exit non-zero, /outreach would read that as a
    # FAILED send, and it would cascade to another channel or retry — pitching
    # a real business owner twice. The IMAP path guards its post-send folder
    # append for exactly this reason; the same protection belongs here.
    final_id = our_id
    try:
        sent_since = datetime.now(timezone.utc) - timedelta(minutes=10)
        for _ in range(5):
            time.sleep(2)
            hit = _find_by_internet_message_id(our_id, folder=FOLDER_SENT)
            if hit:
                final_id = hit.get("internetMessageId") or our_id
                break
        else:
            # Ours never appeared — find the message by subject + recipient and
            # take whatever id Exchange stamped on it. Restricted to the last
            # few minutes and newest-first: repeat touches to the same client
            # reuse the same subject, and Graph's $search ranks by relevance
            # rather than recency, so an unbounded match could adopt an OLD
            # message's id and silently break follow-up threading.
            candidates = [
                m for m in _search_folder(
                    FOLDER_SENT, f"to:{to}", top=25,
                    select="id,internetMessageId,subject,sentDateTime")
                if (m.get("subject") or "") == subject and m.get("internetMessageId")
                and (m.get("sentDateTime") or "") >= sent_since.strftime("%Y-%m-%dT%H:%M:%SZ")
            ]
            if candidates:
                newest = max(candidates, key=lambda m: m.get("sentDateTime") or "")
                final_id = newest["internetMessageId"]
                print(
                    f"NOTE: Exchange rewrote the Message-ID on send; using its "
                    f"version ({final_id}) for thread tracking.",
                    file=sys.stderr,
                )
    except Exception as exc:
        # Delivered, but we couldn't confirm which id Exchange kept. Say so
        # loudly — if it DID rewrite the id, follow-ups will start a new
        # thread rather than continue this one — but never fail the send.
        print(
            f"WARNING: message sent, but the Sent-Items read-back failed ({exc}). "
            f"Recording our own Message-ID; if Exchange rewrote it, the follow-up "
            f"may not thread onto this message.",
            file=sys.stderr,
        )

    print(f"Email sent to {to}")
    print(f"Subject: {subject}")
    print(f"Message-ID: {final_id}")

    # Rate limiting: random 15-30s delay to avoid bulk-sending patterns
    delay = random.uniform(15, 30)
    print(f"Rate limit: waiting {delay:.0f}s before next send...")
    time.sleep(delay)

    return final_id


def draft_email(to, subject, body, attachments=None):
    """Save to the mailbox's Drafts folder WITHOUT sending (manual-approval mode).

    `attachments` is an optional list of file paths (used by /send-invoice).
    Graph's raw-MIME draft endpoint drops multipart attachments, so they go on
    afterwards via POST /me/messages/{id}/attachments — capped at 3MB each,
    the fileAttachment limit (fine for the invoice PDFs this exists for).
    Returns True on success, None on failure (never a Message-ID)."""
    import mimetypes
    from pathlib import Path

    # gmail.py owns the shared path validation. Lazy import, like gmail.py's
    # own lazy import of this module. (Under the CLI, gmail runs as __main__,
    # so this executes gmail.py once more as a module — harmless, its only
    # import-time side effect is env loading, and the existing top-level
    # `from gmail import verify_urls_in_message` does the same.)
    from gmail import check_attachment_paths

    config = get_config()

    att_errors = check_attachment_paths(attachments)
    for att in attachments or []:
        size = Path(att).stat().st_size if Path(att).is_file() else 0
        # Upper bound avoids double-reporting: >25MB already errored above.
        if 3 * 1024 * 1024 < size <= 25 * 1024 * 1024:
            att_errors.append(f"attachment exceeds Microsoft Graph's 3MB draft-attachment limit: {att}")
    if att_errors:
        for err in att_errors:
            print(f"ERROR: {err}", file=sys.stderr)
        return None

    url_errors = verify_urls_in_message(body)
    if url_errors:
        print("WARNING: draft contains URLs that did not return HTTP 200:", file=sys.stderr)
        for err in url_errors:
            print(f"  - {err}", file=sys.stderr)

    msg = _build_mime(config, to, subject, body)
    if attachments:
        # Transactional (invoice) drafts must not carry marketing-list
        # headers — Gmail renders "Unsubscribe" next to a bill. Matches the
        # IMAP backend's behaviour.
        del msg["List-Unsubscribe"]
        del msg["List-Unsubscribe-Post"]
    try:
        resp = graph_request(
            "POST", "/me/messages",
            headers={"Content-Type": "text/plain"},
            data=base64.b64encode(msg.as_bytes()),
        )
    except Exception as exc:
        # Contract: draft_email returns None on failure, never raises — the
        # manual-approval lane must degrade to "no draft" rather than crash
        # the run mid-pipeline.
        print(f"ERROR: could not save draft to Drafts: {exc}", file=sys.stderr)
        return None

    if attachments:
        draft_id = None
        try:
            draft_id = resp.json().get("id")
            if not draft_id:
                raise RuntimeError("Graph did not return the draft's id")
            for att in attachments:
                p = Path(att)
                ctype, _ = mimetypes.guess_type(p.name)
                graph_request(
                    "POST", f"/me/messages/{draft_id}/attachments",
                    json_body={
                        "@odata.type": "#microsoft.graph.fileAttachment",
                        "name": p.name,
                        "contentType": ctype or "application/octet-stream",
                        "contentBytes": base64.b64encode(p.read_bytes()).decode("ascii"),
                    },
                )
        except Exception as exc:
            # A draft that LOOKS complete but is missing its attachment is
            # worse than no draft (the operator would send an invoice email
            # with no invoice) — delete the half-made draft, best-effort.
            print(f"ERROR: could not attach file to draft: {exc}", file=sys.stderr)
            try:
                if draft_id:
                    graph_request("DELETE", f"/me/messages/{draft_id}")
                    print("Removed the incomplete draft from Drafts.", file=sys.stderr)
            except Exception:
                print("WARNING: the incomplete draft may still be in Drafts — delete it by hand.",
                      file=sys.stderr)
            return None

    print("Draft saved to Drafts (NOT sent)")
    print(f"To: {to}")
    print(f"Subject: {subject}")
    for att in attachments or []:
        print(f"Attached: {Path(att).name}")
    print("Note: your mail client assigns the final Message-ID and Date when you send "
          "this draft, so do NOT store this draft as outreach_message_id.")
    return True


def read_emails(days=30, from_filter=None, unread_only=False, max_results=50):
    """Recent inbox messages, same dict shape as gmail.read_emails.

    One documented divergence: `in_reply_to` and `references` are always None
    here. Graph's JSON message shape omits them, and populating them would
    cost one extra raw-MIME fetch PER MESSAGE. Nothing reads them off this
    function — the reply flows get their threading headers from
    fetch_message_by_id / find_latest_in_thread, both of which parse real
    MIME. The keys are still present so callers can't KeyError.
    """
    get_config()  # fail fast with a clear error if not signed in
    since = datetime.now(timezone.utc) - timedelta(days=days)

    if from_filter:
        # KQL participants: matches the address in From/To/Cc — the closest
        # analogue of gmail.py's (OR FROM "x" TO "x").
        # Over-fetch deliberately: Graph forbids $orderby alongside $search, so
        # $top returns the top N by RELEVANCE, not recency — a bare $top can
        # drop the newest reply and make has_inbound_since_last_out read False
        # for someone who has actually answered. Fetch wide, sort, truncate.
        hits = _search_folder(FOLDER_INBOX, f"participants:{from_filter}", top=250)
        results = []
        for m in hits:
            recv = m.get("receivedDateTime") or ""
            try:
                dt = datetime.fromisoformat(recv.replace("Z", "+00:00"))
            except ValueError:
                continue
            if dt < since:
                continue
            if unread_only and m.get("isRead"):
                continue
            results.append(m)
        if not results:
            print("No emails found matching criteria.")
            return []
        # Sort BEFORE mapping (on the ISO timestamp) and before truncating —
        # [-max_results:] must keep the most RECENT messages, which a
        # scrambled order would silently get wrong.
        results.sort(key=_sort_key)
        return [_json_message_to_dict(m) for m in results[-max_results:]]

    filters = [f"receivedDateTime ge {since.strftime('%Y-%m-%dT%H:%M:%SZ')}"]
    if unread_only:
        filters.append("isRead eq false")
    resp = graph_request(
        "GET", f"/me/mailFolders/{FOLDER_INBOX}/messages",
        params={
            "$filter": " and ".join(filters),
            "$select": "id,internetMessageId,subject,from,toRecipients,receivedDateTime,isRead,body",
            "$orderby": "receivedDateTime desc",
            "$top": str(min(max_results, 250)),
        },
        headers=_TEXT_BODY_HEADER,
    )
    messages = resp.json().get("value", [])
    if not messages:
        print("No emails found matching criteria.")
        return []
    # Graph returned newest-first; gmail.read_emails hands back oldest-first
    # (IMAP sequence order), and the CLI prints them in the order given.
    messages.sort(key=_sort_key)
    return [_json_message_to_dict(m) for m in messages]


# One IMAP clause: a keyword plus either a "quoted value" or a bare token.
# Callers in the skills emit both forms, and COMPOUND queries mixing them —
# e.g. follow-up's bounce sweep: FROM "mailer-daemon" SINCE 23-Apr-2026.
_IMAP_CLAUSE_RE = re.compile(
    r'(?P<key>TO|FROM|CC|BCC|SUBJECT|TEXT|BODY|SINCE|BEFORE|ON)\s+(?:"(?P<quoted>[^"]*)"|(?P<bare>\S+))',
    re.IGNORECASE,
)

# IMAP keys gmail.py's docstring advertises to the agent that have NO faithful
# KQL equivalent. Refusing beats mistranslating: `ALL` as free text searches
# for the literal word "ALL" instead of matching every message, and `OR` gets
# dropped so a union silently becomes an intersection (KQL's implicit operator
# is AND) — both return a confidently wrong result set with nothing raised.
_UNSUPPORTED_IMAP_TOKENS = re.compile(r"(?:^|\s)(ALL|UNSEEN|SEEN|FLAGGED|OR|NOT)(?:\s|$)", re.IGNORECASE)

_IMAP_MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def _kql_value(value):
    """Render a value safely as a single KQL term.

    Two failure modes this exists to prevent, both reachable from strings we
    don't control (a client's reply subject, an address):
      - a bare multi-word value silently changes the query's meaning —
        `subject:Klaudius Test` parses as `subject:Klaudius` AND a free-text
        "Test";
      - a stray double quote produces unbalanced/invalid KQL that Graph
        rejects with a 400 — which, now that search failures propagate,
        aborts the caller's whole run.
    Double quotes are STRIPPED rather than escaped: KQL's escaping rules
    aren't dependable enough to bet a buyer's follow-up run on, and a quote
    character is never the meaningful part of an address or subject match.
    """
    value = value.replace('"', " ").strip()
    value = re.sub(r"\s+", " ", value)
    if not value:
        return ""
    return f'"{value}"' if (" " in value or ":" in value) else value


def _imap_date_to_iso(token):
    """IMAP's DD-Mon-YYYY → YYYY-MM-DD for KQL. None if unparseable."""
    m = re.match(r"^(\d{1,2})-([A-Za-z]{3})-(\d{4})$", token.strip().strip('"'))
    if not m:
        return None
    day, mon, year = m.group(1), _IMAP_MONTHS.get(m.group(2).lower()), m.group(3)
    return f"{year}-{mon:02d}-{int(day):02d}" if mon else None


def _imap_query_to_kql(query):
    """Translate the IMAP search syntax gmail.py's callers speak into Graph KQL.

    Handles compound queries, not just a single clause: the follow-up skill's
    bounce sweep sends `FROM "mailer-daemon" SINCE <date>` verbatim, and
    passing that through untranslated would emit nested unescaped quotes that
    Graph rejects outright — failing every /follow-up run on an Outlook
    install now that search failures propagate (as they must, so a partial
    read can never be cached as truth).
    """
    raw = (query or "").strip()
    if not raw:
        return raw

    unsupported = _UNSUPPORTED_IMAP_TOKENS.search(raw)
    if unsupported:
        raise RuntimeError(
            f"IMAP search keyword {unsupported.group(1).upper()!r} has no Microsoft Graph "
            f"equivalent, so this query cannot be translated faithfully: {raw!r}. "
            "Rewrite it using TO / FROM / CC / BCC / SUBJECT / BODY / TEXT / SINCE / BEFORE, "
            "or run one query per term."
        )

    clauses, matched_any = [], False
    for m in _IMAP_CLAUSE_RE.finditer(raw):
        key = m.group("key").upper()
        value = m.group("quoted") if m.group("quoted") is not None else m.group("bare")
        matched_any = True
        if key in ("TO", "FROM", "CC", "BCC", "SUBJECT"):
            safe = _kql_value(value)
            if not safe:
                continue  # empty value would emit a dangling `from:` operator
            clauses.append(f"{key.lower()}:{safe}")
        elif key == "TEXT":
            safe = _kql_value(value)
            if safe:
                clauses.append(safe)  # free text across indexed fields
        elif key == "BODY":
            # NOT free text: KQL free text spans from + subject + body, so a
            # bare term would match messages where the phrase appears only in
            # the SUBJECT or SENDER. IMAP's BODY is body-only, and widening a
            # search is the one direction that produces confident wrong
            # answers rather than visible failures.
            safe = _kql_value(value)
            if safe:
                clauses.append(f"body:{safe}")
        elif key in ("SINCE", "BEFORE", "ON"):
            iso = _imap_date_to_iso(value)
            if iso is None:
                # Drop it outright and say so. Silently re-adding it as free
                # text would change what the query MEANS rather than just
                # losing a filter.
                print(f"WARNING: ignoring unparseable date in search query: {key} {value}",
                      file=sys.stderr)
                continue
            clauses.append(
                f"received>={iso}" if key == "SINCE"
                else f"received<{iso}" if key == "BEFORE"
                else f"received:{iso}"
            )

    if clauses:
        # Deliberately NOT appending unmatched remainder as free text: doing so
        # turns an unrecognised fragment into a required phrase, silently
        # narrowing the result set — and an under-reported thread is exactly
        # what sync_thread_state must never be handed.
        return " ".join(clauses)
    if matched_any:
        # Every clause was empty or undecodable; a blank $search would match
        # the entire folder, so refuse rather than massively WIDEN the query.
        raise RuntimeError(f"search query has no usable terms after translation: {raw!r}")

    # No IMAP keyword at all — free text (warm-leads passes a bare address).
    return _kql_value(raw)


def search_emails(query, max_results=20):
    """Search INBOX + Sent Items, dedup by Message-ID — parity with
    gmail.search_emails, including its IMAP-style query surface."""
    get_config()  # fail fast if not signed in
    kql = _imap_query_to_kql(query)

    results = []
    seen_message_ids = set()
    for folder in (FOLDER_INBOX, FOLDER_SENT):
        # NOTE: deliberately NOT mirroring gmail.py's warn-and-continue on a
        # failed folder. That tolerance exists for a failure mode that cannot
        # occur here: IMAP folder names are operator-configured
        # (EMAIL_SENT_FOLDER), so a misnamed folder is a routine, survivable
        # config error worth skipping past. Graph addresses folders by
        # well-known identifiers ("inbox"/"sentitems") that always exist on
        # every mailbox — so ANY failure here is a genuine server/transport
        # failure, never a naming mistake.
        #
        # Letting that soft-fail would be actively dangerous: a 500 on the
        # SENT search alone returns inbound-only results, and
        # sync_thread_state.py writes whatever comes back straight into
        # Supabase as truth. The client's outgoing_touch_count would reset to
        # 0, which matches neither /follow-up's due predicate (1-4) nor the
        # lapsed sweep (>= 5) — silently stranding a real lead forever with
        # nothing reporting it. Raising leaves the previous cache intact,
        # which is exactly what read_email_messages()'s docstring demands.
        # Over-fetch, then sort and truncate below. Graph forbids $orderby
        # alongside $search, so $top returns the top N by RELEVANCE — whereas
        # gmail.py's IMAP path takes ids[-max_results:], i.e. the N most
        # RECENT. Passing max_results straight through would let the newest
        # inbound reply fall outside the window on a busy mailbox, so
        # has_inbound_since_last_out reads False and /follow-up re-pitches
        # someone who has already answered. No exception, no warning — just a
        # wrong answer, which is the class of failure this lane can least
        # afford.
        hits = _search_folder(folder, kql, top=250)
        for m in hits:
            mid = m.get("internetMessageId") or ""
            if mid and mid in seen_message_ids:
                continue
            if mid:
                seen_message_ids.add(mid)
            d = _json_message_to_dict(m)
            del d["in_reply_to"], d["references"]  # match gmail.search_emails' shape
            d["_ts"] = _sort_key(m)
            results.append(d)

    # Newest max_results per the IMAP contract (its per-folder slice yields at
    # most 2x max_results across the two folders; matching that here).
    results.sort(key=lambda r: r.pop("_ts"))
    results = results[-(max_results * 2):]

    if not results:
        print("No emails found.")
    return results


def fetch_message_by_id(message_id):
    """Sent-folder lookup by Message-ID header → full parsed message dict."""
    try:
        hit = _find_by_internet_message_id(message_id, folder=FOLDER_SENT)
        if not hit:
            return None
        parsed = _parse_mime_bytes(_fetch_raw(hit["id"]))
        return {
            "message_id": parsed["message_id"],
            "date": parsed["date"],
            "from": parsed["from"],
            "subject": parsed["subject"],
            "body": parsed["body"],
            "references": parsed["references"],
        }
    except Exception as exc:
        print(f"WARNING: fetch_message_by_id failed: {exc}", file=sys.stderr)
        return None


def find_thread_recipient_by_message_id(message_id):
    """To-address of the sent message with this Message-ID, or None."""
    try:
        hit = _find_by_internet_message_id(message_id, folder=FOLDER_SENT)
        if not hit:
            return None
        parsed = _parse_mime_bytes(_fetch_raw(hit["id"]))
        to_header = parsed.get("to") or ""
        match = re.search(r"<([^>]+)>", to_header)
        if match:
            return match.group(1).strip().lower()
        return to_header.strip().lower() or None
    except Exception as exc:
        print(f"WARNING: find_thread_recipient_by_message_id failed: {exc}", file=sys.stderr)
        return None


def find_latest_in_thread(to, subject):
    """Most recent Sent Items message to `to` whose subject matches (ignoring
    Re: prefixes). Returns the same dict shape as gmail.find_latest_in_thread."""
    try:
        base_subject = re.sub(r"^\s*(Re:\s*)+", "", subject, flags=re.IGNORECASE).strip().lower()
        hits = _search_folder(
            FOLDER_SENT, f"to:{to}", top=50,
            select="id,internetMessageId,subject,sentDateTime,toRecipients",
        )
        latest = None
        latest_ts = ""
        for m in hits:
            msg_base = re.sub(r"^\s*(Re:\s*)+", "", m.get("subject") or "",
                              flags=re.IGNORECASE).strip().lower()
            if msg_base != base_subject:
                continue
            ts = m.get("sentDateTime") or ""
            if latest is None or ts > latest_ts:
                latest, latest_ts = m, ts
        if latest is None:
            return None
        parsed = _parse_mime_bytes(_fetch_raw(latest["id"]))
        return {
            "message_id": parsed["message_id"],
            "date": parsed["date"],
            "from": parsed["from"],
            "subject": parsed["subject"],
            "body": parsed["body"],
            "references": parsed["references"],
        }
    except Exception as exc:
        print(f"WARNING: find_latest_in_thread failed: {exc}", file=sys.stderr)
        return None
