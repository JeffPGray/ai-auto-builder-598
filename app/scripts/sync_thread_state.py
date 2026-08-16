#!/usr/bin/env python3
"""Refresh per-client thread-state cache fields in Supabase.

Reads the actual SMS thread (chat.db, or Twilio's Messages API when
SMS_PROVIDER=twilio) or email thread (IMAP) for every client whose
conversation might still move (status in outreach_sent / responded), then
writes back six derived fields:
    last_out_date, last_in_date, outgoing_touch_count,
    has_inbound_since_last_out, last_in_preview, thread_synced_at

Run at the start of /follow-up (and /warm-leads) so cache reflects reality
before any scheduling decision. Threads are the source of truth — the DB is a
materialised view of what we read.
"""

import argparse
import json
import os
import re
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from email.utils import parseaddr, parsedate_to_datetime

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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from db import get_db
from imessage import CHAT_DB, extract_text_from_attributed_body, normalize_phone
from gmail import search_emails
import twilio_sms

# Which SMS backend this install sends and reads through. Set by the wizard in
# .env (loaded by the `db` import above): "imessage" reads chat.db locally,
# "twilio" reads Twilio's Messages API. Anything else falls back to chat.db,
# matching the historical behaviour of this script.
SMS_PROVIDER = (os.environ.get("SMS_PROVIDER") or "").strip().lower()

# Where scripts live — used to invoke the WhatsApp shim from this directory
# rather than relying on cwd at runtime.
_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
_WHATSAPP_SHIM = os.path.join(_SCRIPTS_DIR, "whatsapp.mjs")

# Klaudius is single-account by design; OUR_ADDRESSES is the set of email
# addresses sent-by-us messages will show as From. Loaded from .env at
# module import. Stays in sync with gmail.py's get_config().
_OUR = os.environ.get("EMAIL_ADDRESS", "").strip().lower()
OUR_ADDRESSES = {_OUR} if _OUR else set()

# EMAIL_ADDRESS_ALIASES (.env, optional, comma-separated): addresses we
# PREVIOUSLY sent from. Without them, an operator who changed EMAIL_ADDRESS
# has history whose From line names the retired address, so their own old
# outbound reads as INBOUND forever — clients look perpetually owed a reply
# (field report, 2026-08-05). Same failure shape as the OAuth case below.
for _alias in os.environ.get("EMAIL_ADDRESS_ALIASES", "").split(","):
    _alias = _alias.strip().lower()
    if _alias:
        OUR_ADDRESSES.add(_alias)

# On an OAuth (Outlook / Microsoft 365) install the address messages are
# actually SENT AS is the signed-in mailbox, which can legitimately differ
# from EMAIL_ADDRESS: EMAIL_ADDRESS may be an alias, and Exchange rewrites
# From to the mailbox's primary SMTP address regardless of what we set.
# Missing that address here would classify every one of our own outbound
# messages as INBOUND — zeroing outgoing_touch_count (stranding the client,
# since 0 matches neither the 1-4 due predicate nor the >=5 lapsed sweep)
# while surfacing our own outreach copy in reply triage as if the client had
# written it. Both halves wrong, and no exception anywhere to catch it.
if (os.environ.get("EMAIL_AUTH", "").strip().lower() == "oauth-microsoft"):
    try:
        from ms_oauth import get_account
        _signed_in = ((get_account() or {}).get("address") or "").strip().lower()
        if _signed_in:
            OUR_ADDRESSES.add(_signed_in)
    except BaseException:
        # BaseException, not Exception: ms_oauth calls sys.exit(1) at MODULE
        # scope when `requests` is missing, and SystemExit doesn't derive from
        # Exception. init deliberately tolerates a failed pip install, so that
        # state is reachable — and an uncaught SystemExit here would abort the
        # import and take down the WhatsApp and SMS clients too, none of which
        # touch email. gmail.py's read_email_messages guards the same footgun.
        pass  # not signed in / deps missing — the email lane reports it itself


def _resolve_body(text, abody):
    """Resolve the human-readable message body from a chat.db row.

    On macOS Ventura+, the legacy `text` column for sent iMessages often holds
    only a control prefix (e.g. `tring+` or U+FFFC) while the real content
    sits in `attributedBody`. Prefer `attributedBody`; fall back to `text`
    only if the BLOB yielded nothing.
    """
    abody_text = extract_text_from_attributed_body(abody) if abody else None
    if abody_text:
        return abody_text
    if text:
        cleaned = text.replace("￼", "").strip()
        if cleaned.startswith("tring+"):
            cleaned = cleaned[len("tring+"):].strip()
        if cleaned:
            return cleaned
    return None

PREVIEW_CHARS = 200
SMS_REAL_CONTENT_MIN = 10  # below this is a tapback / stub, not a real message


def _utc_iso(dt):
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _chatdb_date_to_dt(raw_date):
    """Cocoa epoch (2001-01-01 UTC) in nanoseconds → aware UTC datetime."""
    cocoa_epoch = datetime(2001, 1, 1, tzinfo=timezone.utc).timestamp()
    return datetime.fromtimestamp(cocoa_epoch + raw_date / 1e9, tz=timezone.utc)


def read_sms_messages(phone, client_email):
    """Pull every message in the chat.db thread keyed by this client's phone or
    email. The fallback to email matters: iMessage threads can be keyed by
    Apple ID rather than phone, and querying by phone alone would miss them
    entirely."""
    handles = []
    if phone:
        handles.append(normalize_phone(phone))
    if client_email:
        handles.append(client_email.lower())
    if not handles:
        return []

    placeholders = ",".join("?" * len(handles))
    conn = sqlite3.connect(CHAT_DB)
    try:
        cur = conn.cursor()
        # Join through `chat` rather than `handle`: outgoing messages have
        # m.handle_id = 0, so a handle-side filter would only catch inbound.
        # `chat.chat_identifier` is the E.164 phone or Apple-ID email that
        # keys the thread, and covers both directions.
        cur.execute(
            f"""
            SELECT m.text, m.attributedBody, m.is_from_me, m.date, m.error
            FROM message m
            JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
            JOIN chat c ON cmj.chat_id = c.ROWID
            WHERE c.chat_identifier IN ({placeholders})
            ORDER BY m.date ASC
            """,
            handles,
        )
        out = []
        for text, abody, is_from_me, raw_date, error in cur.fetchall():
            # Skip outgoing messages that chat.db marked as failed (e.g. error=33
            # when iMessage auth is broken on this Mac). They never delivered, so
            # treating them as touches would falsely advance the cadence and stop
            # us from re-sending. Inbound rows aren't error-checked — Apple uses
            # the field differently for received messages.
            if is_from_me and error and error != 0:
                continue
            body = _resolve_body(text, abody) or ""
            out.append({
                "date": _chatdb_date_to_dt(raw_date),
                "from_me": bool(is_from_me),
                "body": body,
            })
        return out
    finally:
        conn.close()


def read_twilio_sms_messages(phone):
    """Pull the SMS thread for this client from Twilio's Messages API.

    Used instead of chat.db when SMS_PROVIDER=twilio (Windows / Linux
    installs, or macOS operators who chose Twilio in the wizard). Twilio
    threads are keyed by phone number only — there's no Apple-ID/email
    fallback like the chat.db reader has.

    Raises on credential or API failure rather than returning [] — the
    per-client error handling in main() then skips the cache write, so a
    failed read can never be recorded as "no replies".
    """
    if not phone:
        return []
    if not (
        twilio_sms.TWILIO_ACCOUNT_SID
        and twilio_sms.TWILIO_AUTH_TOKEN
        and twilio_sms.TWILIO_FROM_NUMBER
    ):
        # Raise instead of letting twilio_sms._check_env() sys.exit(1) —
        # SystemExit would abort the whole sync run, blocking the email and
        # WhatsApp clients still queued behind this one.
        raise RuntimeError(
            "SMS_PROVIDER=twilio but TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / "
            "TWILIO_PHONE_NUMBER are not all set in .env"
        )

    _undated = datetime.min.replace(tzinfo=timezone.utc)
    out = []
    for m in twilio_sms.read_conversation(phone, limit=100, raise_on_error=True):
        # Skip outbound messages that never reached the recipient (carrier
        # rejection, undeliverable number). Twilio's log keeps them forever;
        # counting them as touches would falsely advance the cadence — the
        # same reason read_sms_messages skips chat.db rows with error != 0.
        if m.get("from_me") and m.get("status") in twilio_sms.UNDELIVERED_STATUSES:
            continue
        dt = twilio_sms._parse_twilio_date(m.get("date"))
        if dt == _undated:
            continue  # no usable timestamp — can't order it in the thread
        out.append({
            "date": dt.astimezone(timezone.utc),
            "from_me": bool(m.get("from_me")),
            "body": m.get("text") or "",
        })
    out.sort(key=lambda m: m["date"])
    return out


_WHATSAPP_PAIRED_CACHE = {}


def whatsapp_account_paired(account):
    """Is this WhatsApp account linked ON THIS MACHINE?

    Auth state is per-machine (`~/.klaudius/whatsapp/<account>/auth/`) while
    Supabase is shared, so a perfectly healthy multi-machine setup has clients
    whose WhatsApp lane simply doesn't exist here. Without this check every one
    of them raises on every run — correct (the cache must not be zeroed) but
    unusably noisy on a machine that never sends WhatsApp. Checked once per
    account per run.
    """
    if not account:
        return False
    if account in _WHATSAPP_PAIRED_CACHE:
        return _WHATSAPP_PAIRED_CACHE[account]
    base = os.environ.get("KLAUDIUS_WHATSAPP_STATE_DIR") or os.path.join(
        os.path.expanduser("~"), ".klaudius", "whatsapp"
    )
    paired = os.path.isfile(os.path.join(base, account, "auth", "creds.json"))
    _WHATSAPP_PAIRED_CACHE[account] = paired
    if not paired:
        print(
            f"  WhatsApp account '{account}' isn't linked on this machine — leaving the "
            "cached thread state for its clients untouched (normal when another machine "
            "owns that number; pair it here if this machine should be sending).",
            file=sys.stderr,
        )
    return paired


def read_whatsapp_messages(phone, account):
    """Pull the WhatsApp thread for this client via the daemon's IPC.

    The daemon mirrors every messages.upsert + messaging-history.set event to a
    local SQLite. We could query that SQLite directly, but going through the
    shim (`node scripts/whatsapp.mjs read`) means the LID-vs-PN jid unification
    happens in the daemon where signalRepository is available — keeping that
    Baileys-protocol logic out of Python. Read is read-only against the SQLite
    so concurrent /follow-up runs are safe (WAL mode).

    `account` is the WhatsApp account label that sent this client's initial
    outreach — must be the same one used for follow-ups (you can't continue a
    WhatsApp thread from a different number). Stored in `outreach_account`
    after the initial send.

    RAISES RuntimeError when the read FAILS (daemon down, account not paired,
    WhatsApp logged the account out, shim timeout). It must never conflate
    "the read failed" with "this thread is empty": compute_state([]) returns
    all-zeros, and sync_one writes that straight to Supabase, which would wipe
    outgoing_touch_count / last_out_date / has_inbound_since_last_out for
    every WhatsApp client on the account. The next /follow-up then reads
    outgoing_touch_count = 0 and re-pitches people who have already been
    contacted — including ones who replied. Raising lets main() log the
    client and LEAVE THE EXISTING CACHE ROW ALONE. Same reasoning (and same
    shape) as the Twilio guard in sync_one.

    Returns [] only when the read genuinely succeeded and the thread is empty.
    """
    if not phone or not account:
        return []
    try:
        result = subprocess.run(
            [
                "node", _WHATSAPP_SHIM, "read",
                "--phone", phone,
                "--account", account,
                "--limit", "500",
            ],
            capture_output=True,
            text=True,
            # Explicit, always: bare text=True decodes with the locale default
            # (cp1252 on Windows), where an emoji in a client reply raised
            # UnicodeDecodeError and hid the reply entirely (field report,
            # 2026-07-27). replace degrades a bad byte to U+FFFD in one body
            # instead of vaporising the whole thread read.
            encoding="utf-8",
            errors="replace",
            timeout=90,
        )
        if result.returncode != 0:
            # Covers the 401 circuit breaker (which now fails in ~0.03s rather
            # than stalling for 30s, so a broken lane is quiet rather than
            # obvious), an unpaired account, and a dead daemon.
            raise RuntimeError(
                f"whatsapp read failed (rc={result.returncode}) for {phone} "
                f"on account '{account}': {result.stderr.strip()[:200]} "
                "— skipping cache write so the existing thread state survives"
            )
        data = json.loads(result.stdout)
        if not data.get("ok"):
            raise RuntimeError(
                f"whatsapp read returned not-ok for {phone} on account "
                f"'{account}': {str(data.get('error'))[:200]} "
                "— skipping cache write so the existing thread state survives"
            )
        out = []
        for m in data.get("messages", []) or []:
            dt_str = m.get("date")
            if not dt_str:
                continue
            try:
                # Daemon emits ISO-8601 with 'Z' suffix; Python <3.11 doesn't
                # accept 'Z' in fromisoformat. Normalise.
                dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
            except (ValueError, TypeError):
                continue
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            out.append({
                "date": dt.astimezone(timezone.utc),
                "from_me": bool(m.get("from_me")),
                "body": m.get("text", "") or "",
            })
        out.sort(key=lambda m: m["date"])
        return out
    except subprocess.TimeoutExpired:
        raise RuntimeError(
            f"whatsapp read timed out for {phone} (account={account}) "
            "— skipping cache write so the existing thread state survives"
        )
    except RuntimeError:
        raise  # already a deliberate skip-the-write signal; don't reclassify
    except Exception as e:
        # Malformed JSON from the shim, decode errors, etc. Same reasoning:
        # an unreadable thread must not be written as an empty one.
        raise RuntimeError(
            f"whatsapp read errored for {phone} (account={account}): {e} "
            "— skipping cache write so the existing thread state survives"
        )


def read_email_messages(client_email, account=None):
    """Pull every email TO or FROM this client. Klaudius is single-account by
    design — the `account` parameter is accepted for signature parity with
    upstream but ignored here.

    RAISES RuntimeError if either search fails, rather than returning what it
    managed to collect. sync_one writes whatever comes back straight to
    Supabase, so a partial read doesn't just lose data, it writes confident
    nonsense. The two queries fetch opposite halves of the thread, and each
    half going missing breaks the cadence differently:

    - Lose the FROM (inbound) half and has_inbound_since_last_out reads False
      for a client who has already replied, while the touch count stays
      plausible. The row still matches /follow-up's due predicate
      (outgoing_touch_count BETWEEN 1 AND 4), so we pitch someone who
      answered - which CLAUDE.md forbids outright. This is the dangerous one,
      and it's reachable: TO is queried first, so FROM is the half that fails
      after a partial success.
    - Lose the TO (outbound) half and the touch count reads 0, which drops the
      row out of the cadence instead.
    - Lose both and the row zeroes entirely, which silently STRANDS the
      client: 0 matches neither the due predicate (1-4) nor the lapsed sweep
      (>= 5), and a null last_in_date keeps it out of reply triage too. It is
      never contacted again and never closed out.

    So the only safe move on a failed read is to write nothing and leave the
    previous cache in place. main() logs it and moves to the next client.
    """
    if not client_email:
        return []

    seen = set()
    out = []

    for query in (f'TO "{client_email}"', f'FROM "{client_email}"'):
        try:
            results = search_emails(query, max_results=50)
        except (Exception, SystemExit) as e:
            # SystemExit is caught deliberately. gmail.get_config() calls
            # sys.exit(1) when EMAIL_ADDRESS / EMAIL_PASSWORD / the host vars
            # are unset, and SystemExit is a BaseException — so without this it
            # sails past main()'s `except Exception` and kills the whole run,
            # abandoning every WhatsApp and SMS client still queued behind this
            # one. Converting it to a RuntimeError keeps the failure scoped to
            # this client. read_twilio_sms_messages guards the same footgun.
            raise RuntimeError(
                f"email search failed ({query}) for {client_email}: {e} "
                "— check EMAIL_ADDRESS / EMAIL_PASSWORD / EMAIL_IMAP_HOST / "
                "EMAIL_SENT_FOLDER in .env. Skipping cache write so the "
                "existing thread state survives"
            )
        for r in results or []:
            mid = r.get("message_id") or ""
            if mid and mid in seen:
                continue
            if mid:
                seen.add(mid)
            try:
                dt = parsedate_to_datetime(r.get("date") or "")
            except Exception:
                continue
            if dt is None:
                continue
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            from_addr = (r.get("from") or "").lower()
            # Equality on the parsed bare address — containment would let an
            # entry that is a suffix of a client's address (ben@x.com vs
            # reuben@x.com) claim the client's replies as ours, silently
            # dropping them from reply triage. Containment only as the
            # fallback for a From header parseaddr can't handle.
            _bare = parseaddr(from_addr)[1]
            from_me = (_bare in OUR_ADDRESSES) if _bare \
                else any(a in from_addr for a in OUR_ADDRESSES)
            out.append({
                "date": dt.astimezone(timezone.utc),
                "from_me": from_me,
                "body": r.get("body") or "",
            })

    out.sort(key=lambda m: m["date"])
    return out


def compute_state(messages):
    out_msgs = [m for m in messages if m["from_me"] and len(m["body"].strip()) >= SMS_REAL_CONTENT_MIN]
    in_msgs = [m for m in messages if not m["from_me"] and m["body"].strip()]

    last_out = max((m["date"] for m in out_msgs), default=None)
    last_in = max((m["date"] for m in in_msgs), default=None)

    if last_in and last_out:
        has_inbound_since = last_in > last_out
    elif last_in:
        has_inbound_since = True
    else:
        has_inbound_since = False

    last_in_preview = None
    if last_in:
        latest = max(in_msgs, key=lambda m: m["date"])
        body = re.sub(r"\s+", " ", latest["body"].strip())
        last_in_preview = body[:PREVIEW_CHARS]

    return {
        "last_out_date": _utc_iso(last_out),
        "last_in_date": _utc_iso(last_in),
        "outgoing_touch_count": len(out_msgs),
        "has_inbound_since_last_out": has_inbound_since,
        "last_in_preview": last_in_preview,
        "thread_synced_at": _utc_iso(datetime.now(tz=timezone.utc)),
    }


def sync_one(db, client, dry_run=False):
    channel = (client.get("outreach_channel") or "").lower()
    # Order matters: 'whatsapp' is checked before 'sms' because both 'sms' and
    # 'whatsapp' substrings can co-occur in future combo channels, and the
    # WhatsApp lane should take precedence when present (the same-channel rule
    # for follow-ups means the WhatsApp thread is the source of truth).
    if "whatsapp" in channel:
        # Skip quietly (one notice per account, not per client) when this
        # machine doesn't hold the auth for that number. Skipping leaves the
        # existing cache row alone, which is what we want — the machine that
        # owns the thread keeps it accurate.
        if not whatsapp_account_paired(client.get("outreach_account")):
            return None
        msgs = read_whatsapp_messages(client.get("phone"), client.get("outreach_account"))
        if not msgs and client.get("outreach_first_sent"):
            # The read succeeded but the thread is empty, yet we recorded an
            # outreach send. Writing zeros here would reset the touch count and
            # re-pitch an already-contacted client, so we must not write.
            #
            # SKIP rather than raise — and this deliberately does NOT mirror the
            # Twilio guard below. Twilio's history lives in Twilio's API, so an
            # empty thread there really is suspicious. WhatsApp's lives in a
            # per-MACHINE SQLite (~/.klaudius/whatsapp/<account>/messages.db)
            # while Supabase is shared across machines. Multi-machine operation
            # is normal, so on a second machine EVERY WhatsApp client has an
            # empty local thread. Raising would error every one of them on every
            # run, forever, with no override — noisy and unrecoverable. Skipping
            # leaves the existing cache row untouched, which is exactly right:
            # the machine that owns the thread keeps the cache accurate.
            print(
                f"  {client.get('slug')}: WhatsApp thread empty locally but outreach was "
                "recorded — leaving the cached thread state untouched (normal on a machine "
                "that didn't send it; otherwise the daemon's SQLite was rebuilt or "
                "outreach_account points at the wrong number).",
                file=sys.stderr,
            )
            return None
    elif "sms" in channel:
        if SMS_PROVIDER == "twilio":
            msgs = read_twilio_sms_messages(client.get("phone"))
            if not msgs and client.get("outreach_first_sent"):
                # Outreach was recorded as sent, yet the current Twilio
                # number has no readable thread with this client. Causes:
                # the operator rotated TWILIO_PHONE_NUMBER, switched
                # SMS_PROVIDER mid-flight, or every send failed at the
                # carrier. Zeroing the cache would silently strand the
                # client, so raise instead — main() logs it and keeps the
                # existing cache row for operator triage.
                raise RuntimeError(
                    "outreach_first_sent is set but the Twilio thread is empty "
                    "(number/provider rotated, or all sends undelivered) — "
                    "skipping cache write, needs operator attention"
                )
        else:
            msgs = read_sms_messages(client.get("phone"), client.get("email"))
    elif "email" in channel:
        msgs = read_email_messages(client.get("email"), client.get("outreach_account"))
        if not msgs and client.get("outreach_first_sent"):
            # The search succeeded but found nothing, yet we recorded an
            # outreach send - and search_emails covers Sent as well as INBOX,
            # so our own outbound message should always be there. Something is
            # wrong: EMAIL_SENT_FOLDER naming, a server-side filter moving
            # outreach out of Sent, retention pruning, or a null email column
            # on a client whose channel says email.
            #
            # Raising matters more here than the "lost data" framing suggests.
            # Writing zeros doesn't just forget the touch count, it makes the
            # row invisible: 0 matches neither /follow-up's due predicate
            # (1-4) nor the lapsed sweep (>= 5), and a null last_in_date keeps
            # it out of reply triage. The client is silently stranded forever,
            # with nothing anywhere reporting it. Mirrors the Twilio guard
            # below; unlike WhatsApp this does NOT need a skip, because the
            # mailbox is server-side and readable from any machine.
            raise RuntimeError(
                "outreach_first_sent is set but the email thread is empty "
                "(check EMAIL_SENT_FOLDER in .env, a filter moving sent mail, "
                "or a missing email address on this client) — skipping cache "
                "write, needs operator attention"
            )
    else:
        return None  # instagram_dm / facebook_messenger — still manual-lane (no auto-readable backend)

    state = compute_state(msgs)
    if not dry_run:
        db.table("clients").update(state).eq("slug", client["slug"]).execute()
    return state


def fetch_clients(db, statuses, slug=None):
    if slug:
        resp = (
            db.table("clients")
            .select("slug,phone,email,outreach_channel,outreach_account,outreach_first_sent")
            .eq("slug", slug)
            .execute()
        )
        return resp.data or []

    out = []
    page_size = 1000
    offset = 0
    while True:
        resp = (
            db.table("clients")
            .select("slug,phone,email,outreach_channel,outreach_account,outreach_first_sent")
            .in_("status", statuses)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        page = resp.data or []
        out.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--slug", help="Sync a single client by slug")
    parser.add_argument(
        "--statuses",
        default="outreach_sent,responded",
        help="Comma-separated statuses to sync (default: outreach_sent,responded)",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--quiet", action="store_true", help="Suppress per-client lines")
    args = parser.parse_args()

    db = get_db()
    statuses = [s.strip() for s in args.statuses.split(",") if s.strip()]
    clients = fetch_clients(db, statuses, slug=args.slug)
    print(f"Syncing {len(clients)} client(s)...", file=sys.stderr)

    n_ok = n_skip = n_err = 0
    for c in clients:
        try:
            state = sync_one(db, c, dry_run=args.dry_run)
            if state is None:
                n_skip += 1
                continue
            n_ok += 1
            if not args.quiet:
                print(
                    f"  {c['slug']}: out={state['outgoing_touch_count']}"
                    f" last_out={state['last_out_date'] or '-'}"
                    f" last_in={state['last_in_date'] or '-'}"
                    f" pending={state['has_inbound_since_last_out']}"
                )
        except Exception as e:
            n_err += 1
            print(f"  ERROR {c.get('slug')}: {e}", file=sys.stderr)

    print(f"Synced {n_ok}, skipped {n_skip}, errors {n_err}", file=sys.stderr)


if __name__ == "__main__":
    main()
