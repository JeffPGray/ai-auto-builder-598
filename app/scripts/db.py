#!/usr/bin/env python3
"""
db.py - Supabase client library for the Klaudius pipeline.

Supabase client library for all pipeline database operations.

Usage from scripts:
    from db import get_client_by_slug, update_status, set_response

Usage from Claude Code (one-liners):
    python3 -c "from scripts.db import get_incomplete_clients; print(get_incomplete_clients())"

Conversation state (last_out_date, last_in_date, outgoing_touch_count, ...) is
NOT written from here. It is materialised from threads by
scripts/sync_thread_state.py — the cache is downstream of the thread, not the
DB.
"""

import os
import subprocess
import re
import sys
from datetime import datetime, date
from typing import Optional
from pathlib import Path

# Windows stdout/stderr default to cp1252, and client-authored text (names,
# notes, last_in_preview) is routinely emoji-bearing — printing it dies with
# UnicodeEncodeError, which killed a real operator's reply check mid-run
# (2026-07-17). Force UTF-8: everything that consumes this output (Claude
# Code, the skills, sibling scripts capturing the pipe) reads it as UTF-8,
# and errors="replace" keeps any hostile byte from crashing a run.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Make Python's ssl module trust the OS root-CA store before any HTTPS
# library is imported. Without this, Windows machines whose antivirus /
# corporate-proxy MITMs HTTPS hit UNABLE_TO_VERIFY_LEAF_SIGNATURE on every
# Supabase call at pipeline runtime (certifi's bundled list doesn't include
# the AV's intercepting cert). Mirrors NODE_OPTIONS=--use-system-ca on the
# Node side. No-op on systems without interception. Guarded so older
# Klaudius setups (pre-0.7.1, no truststore in pip install list) still run.
try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

from supabase import create_client, Client
from dotenv import load_dotenv

# Load .env from project root
load_dotenv(Path(__file__).parent.parent / ".env")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

_client: Optional[Client] = None


def get_db() -> Client:
    """Get or create the Supabase client singleton."""
    global _client
    if _client is None:
        if not SUPABASE_URL or not SUPABASE_KEY:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env"
            )
        _client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _client


# ---------------------------------------------------------------------------
# Read operations
# ---------------------------------------------------------------------------

def get_client_by_slug(slug: str) -> Optional[dict]:
    """Fetch a single client by slug. Returns None if not found."""
    resp = get_db().table("clients").select("*").eq("slug", slug).execute()
    rows = resp.data
    return rows[0] if rows else None


def get_clients_by_status(status: str) -> list[dict]:
    """Fetch all clients with a given status."""
    resp = get_db().table("clients").select("*").eq("status", status).execute()
    return resp.data or []


def get_incomplete_clients() -> list[dict]:
    """Get clients not in a terminal/stable status."""
    # Filtered server-side (Fable consult, 2026-08-18) — the old version pulled the ENTIRE clients
    # table over the wire just to discard most of it in Python; identical semantics, real payload
    # and round-trip saving at 50-100 builds/day growing the table fast.
    terminal = ("claimed", "outreach_sent", "responded", "converted", "rejected", "lapsed", "unreachable")
    resp = get_db().table("clients").select("slug, name, status").not_.in_("status", list(terminal)).execute()
    return resp.data or []


def _normalize_phone(phone: str) -> str:
    """Strip spaces, dashes, and parens so phone comparisons are format-agnostic."""
    return "".join(c for c in phone if c.isdigit() or c == "+")


def search_by_phone(phone: str) -> Optional[dict]:
    """Find a client by phone number (normalized comparison)."""
    needle = _normalize_phone(phone)
    resp = get_db().table("clients").select("*").execute()
    for row in resp.data:
        if row.get("phone") and _normalize_phone(row["phone"]) == needle:
            return row
    return None


def search_by_owner(name: str) -> list[dict]:
    """Find clients by owner name (case-insensitive partial match)."""
    resp = get_db().table("clients").select("*").ilike("owner", f"%{name}%").execute()
    return resp.data or []


def get_all_clients() -> list[dict]:
    """Fetch all clients."""
    resp = get_db().table("clients").select("*").execute()
    return resp.data or []


def get_latest_outreach_client() -> Optional[dict]:
    """Get the most recently outreached client."""
    resp = (
        get_db()
        .table("clients")
        .select("*")
        .eq("status", "outreach_sent")
        .not_.is_("outreach_first_sent", "null")
        .order("outreach_first_sent", desc=True)
        .limit(1)
        .execute()
    )
    rows = resp.data
    return rows[0] if rows else None


def count_by_status() -> dict[str, int]:
    """Get count of clients per status."""
    resp = get_db().table("clients").select("status").execute()
    counts: dict[str, int] = {}
    for row in (resp.data or []):
        s = row["status"]
        counts[s] = counts.get(s, 0) + 1
    return counts




# ---------------------------------------------------------------------------
# Write operations
# ---------------------------------------------------------------------------

class DuplicateClientError(RuntimeError):
    """Insert lost to a UNIQUE constraint — the business is already in the
    database, usually inserted by a parallel session moments earlier."""


def add_client(data: dict) -> dict:
    """Insert a new client. data must include at least slug, name, status.
    Raises DuplicateClientError if the business already exists (unique
    violation on slug / email / phone)."""
    if data.get("phone"):
        data = {**data, "phone": _normalize_phone(data["phone"])}
    try:
        resp = get_db().table("clients").insert(data).execute()
    except Exception as exc:
        # Postgres unique violation surfaces as a postgrest APIError with
        # SQLSTATE 23505. Duck-typed on .code so this survives supabase-py
        # version drift across customer installs.
        if getattr(exc, "code", None) == "23505":
            raise DuplicateClientError(
                f"This business is already in the database ({exc}). Drop "
                "this candidate and move to the next. Do NOT retry the "
                "insert or claim_client this slug. A parallel session "
                "likely got it first; if no parallel run is happening, the "
                "duplicate check missed an existing row — flag that in "
                "your final summary."
            ) from exc
        raise
    return resp.data[0]


def update_client(slug: str, updates: dict) -> dict:
    """Update arbitrary fields on a client by slug."""
    resp = get_db().table("clients").update(updates).eq("slug", slug).execute()
    if not resp.data:
        raise ValueError(f"Client not found: {slug}")
    return resp.data[0]


def update_status(slug: str, new_status: str) -> dict:
    """Update a client's status."""
    return update_client(slug, {"status": new_status})


def get_imessage_capable(slug: str) -> Optional[bool]:
    """Read the cached iMessage-capability flag for this client.

    Returns True / False if a probe result has ever been written, or None if
    the column is unset (i.e. the client has never been probed). Callers
    should treat None as "unknown" and either run a live IDS probe or default
    to SMS — see scripts/imessage.py:get_thread_service for the routing rules.

    The cached value is treated as authoritative once set; chat.db post-send
    checks remain the safety net for stale values."""
    client = get_client_by_slug(slug)
    if not client:
        return None
    val = client.get("imessage_capable")
    return val if isinstance(val, bool) else None


def set_imessage_capable(slug: str, capable: bool) -> dict:
    """Cache the result of an IDS probe for this client. Idempotent — safe to
    call repeatedly with the same value (no-op effect on the row beyond
    bumping updated_at)."""
    return update_client(slug, {"imessage_capable": bool(capable)})


def get_imessage_capable_by_phone(phone: str) -> Optional[bool]:
    """Same as get_imessage_capable but keyed on phone (any format that
    normalises to the value stored in the clients.phone column).
    Used by imessage.py, which only knows the recipient's phone, not slug.
    Returns None if no client matches or the column is unset."""
    client = search_by_phone(phone)
    if not client:
        return None
    val = client.get("imessage_capable")
    return val if isinstance(val, bool) else None


def set_imessage_capable_by_phone(phone: str, capable: bool) -> Optional[dict]:
    """Best-effort cache write keyed by phone. Returns the updated row, or
    None if no client matches that phone (phones are normalised, so this is
    rare). Callers should not raise on None — the cache write is opportunistic."""
    client = search_by_phone(phone)
    if not client:
        return None
    return update_client(client["slug"], {"imessage_capable": bool(capable)})


def claim_client(slug: str, claimed_by: str = "claude") -> bool:
    """Atomically claim a client. Returns True if successful, False if already claimed.

    Uses conditional update: only succeeds if current status allows claiming.
    """
    claimable = ("found", "gathered", "built", "deployed")
    resp = (
        get_db()
        .table("clients")
        .update({
            "status": "claimed",
            "claimed_at": datetime.utcnow().isoformat(),
            "claimed_by": claimed_by,
        })
        .eq("slug", slug)
        .in_("status", list(claimable))
        .execute()
    )
    return bool(resp.data)


def update_deployed_url(slug: str, url: str) -> dict:
    """Set the deployed URL for a client, then mirror into GHL.

    THIS is the call that enrols a prospect in "GR-598 Demo-First Send".
    That workflow triggers on `Tag added includes "demo-built"` and sends the
    prospect's first email itself, so the tag has to land the moment the demo
    site is live - not later, when outreach is recorded. Tagging at send time
    would deliver two first-touch emails: one from the mailbox, one from GHL.

    Best-effort, exactly like the send-time mirror: Supabase is the source of
    truth and a GHL outage must never cost us the deployed_url write. Re-run a
    missed one by hand with `python3 scripts/ghl.py mirror SLUG`.
    """
    row = update_client(slug, {"deployed_url": url, "status": "deployed"})
    _mirror_to_ghl(slug, row, stage="deploy")
    return row


def claim_outreach(slug: str, claimed_by: str = "claude") -> bool:
    """Atomically claim outreach for a client. Returns True if successful.

    Must be called BEFORE sending any outreach. Only succeeds if no outreach
    has been sent or claimed yet (outreach_account is null AND outreach_channel
    is null). This prevents duplicate outreach when multiple sessions run in
    parallel.

    If the send fails after claiming, call release_outreach_claim() to unlock.
    """
    resp = (
        get_db()
        .table("clients")
        .update({
            "outreach_account": f"claiming:{claimed_by}",
        })
        .eq("slug", slug)
        .is_("outreach_account", "null")
        .is_("outreach_channel", "null")
        .execute()
    )
    return bool(resp.data)


def release_outreach_claim(slug: str) -> dict:
    """Release an outreach claim if the send failed (e.g. SMTP error).

    Resets outreach_account back to null so another session can retry.
    """
    return update_client(slug, {
        "outreach_account": None,
    })


_WHATSAPP_LABEL_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def set_outreach_sent(
    slug: str,
    channel: str,
    sent_date: Optional[str] = None,
    message_id: str = "",
    subject: str = "",
    account: str = "",
) -> dict:
    """Mark outreach as sent, including channel and (for WhatsApp) account.

    Should only be called AFTER a successful send, and after claim_outreach()
    returned True. Always overwrites outreach_account so that the claim slot
    `'claiming:<actor>'` set by claim_outreach is replaced with the real
    sending account (WhatsApp account label like 'primary' / 'secondary') or NULL
    (for email/SMS, where no account applies). Leaving the claim string in
    place was a silent bug that polluted the column for every send.

    Defensive validation (raises ValueError):
      - channel='whatsapp' REQUIRES a non-empty `account` arg. Follow-ups must
        use the same WhatsApp account that sent the original (you can't continue
        a WhatsApp thread from a different number), so the label has to be
        recorded. If you forget, `/follow-up` silently rots on this client.
        Pull the account from the JSON the shim emitted (e.g. `{"account":
        "primary", ...}`).
      - channel='email' or 'sms' REQUIRES `account` be EMPTY. These channels
        don't have account routing; a non-empty value here is almost certainly
        a copy-paste mistake from the WhatsApp branch. Letting it through
        would write a phantom account into outreach_account that confuses
        sync_thread_state.py and `/warm-leads`.
    """
    if channel == "whatsapp":
        if not account:
            raise ValueError(
                "set_outreach_sent('SLUG', 'whatsapp', ...) requires the `account` "
                "arg. Pull it verbatim from the JSON the shim returned: "
                "`{\"ok\": true, \"account\": \"primary\", ...}`. Without it, "
                "follow-ups can't continue this WhatsApp thread."
            )
        if not _WHATSAPP_LABEL_RE.match(account):
            raise ValueError(
                f"set_outreach_sent: 'whatsapp' account must be a label like "
                f"'primary' or 'secondary' (letters, digits, underscore, hyphen only). "
                f"Got: {account!r}"
            )
    elif channel in ("email", "sms"):
        if account:
            raise ValueError(
                f"set_outreach_sent: channel={channel!r} doesn't use account "
                f"routing. Pass account='' (or omit it). Got: {account!r}. "
                f"This is usually a copy-paste from the WhatsApp branch — "
                f"those routing labels don't apply to {channel}."
            )

    if sent_date is None:
        sent_date = date.today().isoformat()
    updates: dict = {
        "status": "outreach_sent",
        "outreach_channel": channel,
        "outreach_first_sent": sent_date,
        "outreach_account": account or None,
    }
    if message_id:
        updates["outreach_message_id"] = message_id
    if subject:
        updates["outreach_subject"] = subject
    row = update_client(slug, updates)

    # GHL mirror. Supabase (the write above) is the source of truth; GHL is a
    # read-only-to-us mirror for the sales team. Fires only here, i.e. only
    # after a send has actually succeeded, so a contact never appears in the
    # CRM for a message that was never delivered.
    #
    # Deliberately AFTER the DB write and deliberately swallowing everything:
    # a GHL outage, a revoked token or a Cloudflare challenge must never turn
    # a delivered email into an unrecorded one. Worst case is a warning on
    # stderr and a row that can be re-mirrored by hand with
    # `python3 scripts/ghl.py mirror SLUG`.
    _mirror_to_ghl(slug, row, stage="outreach_sent")

    return row


def _notify(message: str) -> None:
    """Fire scripts/notify.sh (Telegram/email/SMS per NOTIFY_CHANNEL).

    The mirror used to fail to stderr only. That was defensible while GHL was
    pure bookkeeping; it is not now. Since the `demo-built` tag is what makes
    GoHighLevel send the prospect's first email, a failed mirror is a lead that
    silently never gets contacted - invisible in an unattended run, which
    CLAUDE.md's alerting rule ("assume nobody is watching, bias toward
    over-alerting") exists precisely to catch.

    Swallows everything: an alerting problem must never escalate into a
    pipeline problem. notify.sh already no-ops silently when NOTIFY_CHANNEL is
    unconfigured, so this is safe on a bare install.
    """
    try:
        subprocess.run(
            ["bash", os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                  "notify.sh"), message],
            check=False,
            capture_output=True,
            timeout=20,
        )
    except Exception:  # noqa: BLE001 - alerting must never break the pipeline
        pass


def _mirror_to_ghl(
    slug: str, row: Optional[dict] = None, stage: str = "deploy"
) -> None:
    """Best-effort mirror of a just-sent client into GoHighLevel.

    Never raises. Never blocks. See scripts/ghl.py for the request shape and
    the four GHL traps it exists to avoid.
    """
    try:
        # db.py is imported both as `scripts.db` (from the project root, where
        # scripts/ is NOT on sys.path) and as `db` (from inside scripts/).
        # Put scripts/ on the path so the sibling import resolves either way -
        # otherwise the mirror would "fail" as a bare ImportError depending
        # only on how the caller happened to import db.
        _here = os.path.dirname(os.path.abspath(__file__))
        if _here not in sys.path:
            sys.path.insert(0, _here)
        import ghl  # noqa: PLC0415 - deferred so db.py works with no GHL config

        if not ghl.is_configured():
            return
        result = ghl.mirror_client(
            row or get_client_by_slug(slug) or {}, stage=stage
        )
        if result.get("ok"):
            print(
                f"GHL mirror: contact={result.get('contact_id')} "
                f"opportunity={result.get('opportunity_id')} ({slug})"
            )
            # SUCCESS alert, deploy only. Previously only failures alerted, so
            # silence meant either "all good" or "the alerting itself broke" -
            # indistinguishable, which is the failure mode CLAUDE.md's alerting
            # rule warns about. One line per finished build, with the URL the
            # operator actually wants to click.
            if stage == "deploy":
                src = row or get_client_by_slug(slug) or {}
                name = src.get("name") or slug
                url = (src.get("deployed_url") or "").strip() or "(no URL recorded)"
                if result.get("enrolled"):
                    outcome = ("CRM contact + opportunity created, tagged "
                               "demo-built, GR-598 sequence STARTED")
                else:
                    outcome = ("CRM contact + opportunity created. NOT tagged, "
                               "so no email will go out - set OUTBOUND_SENDER=ghl "
                               "and OUTREACH_ENABLED=true to arm sending")
                _notify(f"Build for {name} is live: {url} -- {outcome}")
        elif result.get("skipped"):
            print(
                f"GHL mirror skipped for {slug}: {result['skipped']} "
                f"({result.get('detail', '')})",
                file=sys.stderr,
            )
        else:
            print(
                f"GHL mirror FAILED for {slug}: {result.get('error')}. The "
                f"Supabase record is intact. Retry with: "
                f"python3 scripts/ghl.py mirror {slug}",
                file=sys.stderr,
            )
            _notify(
                f"[{slug}] GHL mirror FAILED at stage={stage}: "
                f"{result.get('error')}. Supabase is intact, but this lead is "
                f"NOT enrolled in GR-598 Demo-First Send - it will never be "
                f"emailed. Retry: python3 scripts/ghl.py mirror {slug}"
            )
    except Exception as exc:  # noqa: BLE001 - the mirror must never break a send
        print(
            f"GHL mirror errored for {slug}: {exc}. The Supabase record is "
            f"intact. Retry with: python3 scripts/ghl.py mirror {slug}",
            file=sys.stderr,
        )
        _notify(
            f"[{slug}] GHL mirror ERRORED at stage={stage}: {exc}. Supabase is "
            f"intact, but this lead is NOT enrolled in GR-598 Demo-First Send. "
            f"Retry: python3 scripts/ghl.py mirror {slug}"
        )


_VALID_CLASSIFICATIONS = ("noise", "genuine", "rejection", "unclear")


def classify_inbound(slug: str, classification: str, for_date: str) -> dict:
    """Persist a classification decision for the latest inbound on a client.

    `classification` is one of:
      - 'noise'      — auto-ack, OOO, tapback. Doesn't block the cadence.
      - 'genuine'    — real engagement; needs human reply (-> set_response).
      - 'rejection'  — clear no; needs human action (-> set_rejected).
      - 'unclear'    — defer to human review.

    `for_date` should be the row's current `last_in_date` — the classification
    is treated as fresh only while it equals last_in_date. When a new inbound
    arrives, last_in_date advances and the classification becomes stale,
    forcing re-review."""
    if classification not in _VALID_CLASSIFICATIONS:
        raise ValueError(
            f"classification must be one of {_VALID_CLASSIFICATIONS}, got {classification!r}"
        )
    return update_client(slug, {
        "last_in_classification": classification,
        "last_in_classified_for_date": for_date,
    })


def set_response(slug: str, note: str = "") -> dict:
    """Move client to `responded`. Optional `note` is appended to `notes`
    (the cached `last_in_preview` and the actual thread carry the verbatim
    reply, so the DB doesn't need its own copy)."""
    updates: dict = {"status": "responded"}
    if note:
        updates["notes"] = note
    return update_client(slug, updates)


def set_rejected(slug: str, note: str = "") -> dict:
    """Mark client as rejected."""
    updates: dict = {"status": "rejected"}
    if note:
        updates["notes"] = note
    return update_client(slug, updates)


def set_unreachable(slug: str, note: str = "") -> dict:
    """Mark client as unreachable."""
    updates: dict = {"status": "unreachable"}
    if note:
        updates["notes"] = note
    return update_client(slug, updates)


def set_lapsed(slug: str, note: str = "") -> dict:
    """Mark client as lapsed (completed full outreach sequence with no response)."""
    updates: dict = {"status": "lapsed"}
    if note:
        updates["notes"] = note
    return update_client(slug, updates)


# ---------------------------------------------------------------------------
# CLI convenience
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Campaign runs — coverage ledger for "run N lanes chasing X in region Y"
# ---------------------------------------------------------------------------
# A campaign_run is a unit of operator intent ("HVAC + plumbing within 10mi
# of The Woodlands, TX, 30 sites") distinct from the individual `clients`
# rows it produces. Without this, a repeated or overlapping request has no
# way to know an area/trade combination was already chased. clients.
# campaign_run_id links each built site back to the run that produced it.
#
# This is a ledger, not a hard gate: /find still does its own per-client
# duplicate check against `clients` regardless of campaign coverage. Coverage
# answers "has this territory been worked", not "is this exact business new".

def start_campaign_run(
    region_label: str,
    city: str = None,
    state: str = None,
    industries: list = None,
    lane_count: int = 1,
    target_count: int = None,
    radius_miles: float = None,
    country: str = None,
    notes: str = None,
) -> dict:
    """Create a new campaign run and return the row (includes its id).
    Call this BEFORE dispatching lanes for a "run N lanes chasing X in Y" ask."""
    data = {
        "region_label": region_label,
        "city": city,
        "state": state,
        "country": country,
        "radius_miles": radius_miles,
        "industries": industries or [],
        "lane_count": lane_count,
        "target_count": target_count,
        "notes": notes,
    }
    data = {k: v for k, v in data.items() if v is not None}
    resp = get_db().table("campaign_runs").insert(data).execute()
    return resp.data[0]


def get_campaign_coverage(city: str = None, state: str = None, industries: list = None) -> list:
    """Look up prior/ongoing campaign runs matching a region and/or industry set.
    Call this BEFORE starting a new run so a repeated ask ('run HVAC in The
    Woodlands again') surfaces what was already chased instead of blindly
    re-running it. Matches on city/state equality (case-insensitive) and, if
    industries is given, any overlap with the run's industries array."""
    q = get_db().table("campaign_runs").select("*")
    if city:
        q = q.ilike("city", city)
    if state:
        q = q.ilike("state", state)
    resp = q.order("started_at", desc=True).execute()
    rows = resp.data
    if industries:
        wanted = {i.lower() for i in industries}
        rows = [
            r for r in rows
            if wanted & {i.lower() for i in (r.get("industries") or [])}
        ]
    return rows


def get_campaign_run(run_id: str) -> Optional[dict]:
    resp = get_db().table("campaign_runs").select("*").eq("id", run_id).execute()
    return resp.data[0] if resp.data else None


def record_campaign_site_built(run_id: str, slug: str, by: int = 1) -> None:
    """Atomically bump built_count on a run and stamp the client row with the
    run it belongs to. Call this once a client reaches 'built' or 'deployed'
    status during a campaign run."""
    get_db().rpc("increment_campaign_built", {"p_run_id": run_id, "p_by": by}).execute()
    update_client(slug, {"campaign_run_id": run_id})


def complete_campaign_run(run_id: str, notes: str = None) -> dict:
    """Mark a campaign run completed. Call when the target_count is reached
    or the operator explicitly ends the run early."""
    updates = {"status": "completed", "completed_at": datetime.utcnow().isoformat()}
    if notes:
        updates["notes"] = notes
    resp = get_db().table("campaign_runs").update(updates).eq("id", run_id).execute()
    if not resp.data:
        raise ValueError(f"Campaign run not found: {run_id}")
    return resp.data[0]


def pause_campaign_run(run_id: str, notes: str = None) -> dict:
    updates = {"status": "paused"}
    if notes:
        updates["notes"] = notes
    resp = get_db().table("campaign_runs").update(updates).eq("id", run_id).execute()
    if not resp.data:
        raise ValueError(f"Campaign run not found: {run_id}")
    return resp.data[0]


if __name__ == "__main__":
    import json

    if len(sys.argv) < 2:
        print("Usage: python3 scripts/db.py <command> [args]")
        print("Commands: status, incomplete, client <slug>, all-slugs, coverage <city> <state> [industry...]")
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "status":
        counts = count_by_status()
        total = sum(counts.values())
        print(f"Total clients: {total}")
        for s, n in sorted(counts.items(), key=lambda x: -x[1]):
            print(f"  {s}: {n}")

    elif cmd == "incomplete":
        for c in get_incomplete_clients():
            print(f"  INCOMPLETE: {c['slug']} - status: {c['status']}")

    elif cmd == "all-slugs":
        clients = get_all_clients()
        for c in clients:
            phone = c.get("phone") or ""
            owner = c.get("owner") or ""
            status = c.get("status") or ""
            print(f"{c['slug']} | {phone} | {owner} | {status}")

    elif cmd == "client" and len(sys.argv) > 2:
        c = get_client_by_slug(sys.argv[2])
        if c:
            print(json.dumps(c, indent=2, default=str))
        else:
            print(f"Not found: {sys.argv[2]}")

    elif cmd == "coverage" and len(sys.argv) > 3:
        city, state = sys.argv[2], sys.argv[3]
        industries = sys.argv[4:] or None
        rows = get_campaign_coverage(city=city, state=state, industries=industries)
        if not rows:
            print(f"No campaign runs found for {city}, {state}" + (f" / {industries}" if industries else ""))
        for r in rows:
            print(
                f"  [{r['status']}] {r['region_label']} — industries={r.get('industries')} "
                f"lanes={r.get('lane_count')} built={r.get('built_count')}/{r.get('target_count')} "
                f"started={r.get('started_at')} completed={r.get('completed_at') or '-'}"
            )

    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)
