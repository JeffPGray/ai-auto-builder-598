#!/usr/bin/env python3
"""ghl.py - GoHighLevel MIRROR for the Klaudius pipeline.

Supabase stays the source of truth. GHL is a mirror: every successful send
gets a contact upserted into the Gray Reserve sub-account (with the deployed
site URL on a custom field) and an opportunity placed at the right pipeline
stage. Nothing in here ever sends a message.

WHY THE SEND STAYS OFF LEADCONNECTOR
------------------------------------
This deliberately does NOT repoint scripts/gmail.py at LeadConnector. The
vendor's own send path already carries things a shared LeadConnector pool
would cost us, all three verified in scripts/gmail.py:

  * `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
  * `In-Reply-To` / `References` threading, so follow-ups stay in one thread
  * a hard block (`verify_urls_in_message`) that refuses to send when the
    deployed site URL is not live

Cold outreach is where a shared-pool deliverability profile shows first. Send
on the warmed mailbox; record in GHL.

THE FOUR TRAPS THIS FILE EXISTS TO AVOID
----------------------------------------
1. WRITE CUSTOM FIELDS BY ID, NEVER BY KEY. GHL silently drops an unknown
   custom-field key and still returns 2xx. A `gr_185_demo_url` typo (the real
   key is `gr185_demo_url`) wrote nothing for months and reported success
   every single time. Everything here writes `{"id": ..., "field_value": ...}`.
   Note also `field_value`, not `value` - `value` is silently ignored.
2. EVERY REQUEST NEEDS A BROWSER USER-AGENT. Without one, Cloudflare answers
   with a 200 carrying an HTML challenge and no JSON, so a paginated read
   silently caps at page 1 and a write looks like it worked.
3. SANITIZE EMAIL AND PHONE INDEPENDENTLY, AND OMIT A BAD ONE. GHL 422s the
   whole contact upsert on a malformed email and 400s on a malformed phone.
   A bad identifier is dropped from the body, not sent. If neither survives,
   the upsert is not attempted at all.
4. NEVER LET THE MIRROR BREAK THE PIPELINE. The DB write is the real record;
   a GHL outage must not turn a delivered email into an unrecorded one. Every
   entry point here is best-effort and returns a result dict instead of
   raising into the caller.

Ported from the working platform client at
`platform/packages/shared/src/lib/ghl/` on `origin/platform/main`
(client.ts, contacts.ts, opportunities.ts, identifiers.ts, safety.ts,
pipeline-ids.ts, prospect-etl.ts). Same base URL, version header, UA, retry
policy, body shapes and sanitizer semantics - deliberately not a new design.

Stdlib-only on purpose (urllib, no `requests`) so the mirror adds no
dependency to the vendor's install.

CONFIGURATION
-------------
Exactly ONE value has to be supplied by hand, and it is a secret:

    GHL_API_KEY=pit-...        # sub-account Private Integration token

It goes in `app/.env` and nowhere else. `app/.gitignore` catches it with the
`.env*` glob (which also catches operator copies like `.env.backup`), so it
cannot be committed. Never put it in a script, a skill, a commit message or
a ledger entry.

Every other value has a default that was read LIVE from the Gray Reserve
sub-account on 2026-08-15 rather than guessed, so a correct mirror needs no
UUID typing. Override in `app/.env` only if the pipeline is restructured:

    GHL_LOCATION_ID             fHLsjtxsf1nWzIfVvxY6
    GHL_PIPELINE_ID             JpMRvchzprTlgFFtY8TT   ("$185 Site Pipeline")
    GHL_STAGE_ID_OUTREACH_SENT  738f4d3b-...-1bee...   (stage "Outreach Sent")
    GHL_DEMO_URL_FIELD_ID       uejY9J7kzO4drvb77DKW   (contact.gr185_demo_url)
    GHL_OPP_VALUE               1774                   ($598 + 12 x $98)
    GHL_MIRROR_ENABLED          1                      (set 0 to disable)

`python3 scripts/ghl.py doctor` verifies all of it against the live account
and writes nothing.

CLI
---
    python3 scripts/ghl.py doctor              # verify creds + ids, writes nothing
    python3 scripts/ghl.py mirror SLUG --dry-run   # show the exact payloads
    python3 scripts/ghl.py mirror SLUG         # perform the mirror
    python3 scripts/ghl.py show SLUG           # read back contact + opportunity
"""

import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

try:
    import truststore

    truststore.inject_into_ssl()
except ImportError:
    pass

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass


# ---------------------------------------------------------------------------
# Constants - ported verbatim from packages/shared/src/lib/ghl/
# ---------------------------------------------------------------------------

ROOT_DIR = Path(__file__).resolve().parent.parent

GHL_API_BASE = "https://services.leadconnectorhq.com"
GHL_API_VERSION = "2021-07-28"

# safety.ts: GRAY_RESERVE_LOCATION_ID
DEFAULT_LOCATION_ID = "fHLsjtxsf1nWzIfVvxY6"

# pipeline-ids.ts: PIPELINE_IDS.SITE_185 / STAGES_SITE_185.OUTREACH_SENT.
# Both re-verified live on 2026-08-15 against the sub-account itself
# (pipeline "$185 Site Pipeline", stage "Outreach Sent", position 1).
DEFAULT_PIPELINE_ID = "JpMRvchzprTlgFFtY8TT"
DEFAULT_STAGE_ID = "738f4d3b-69cf-40fe-ab8d-4a4340d1dd9c"

# prospect-etl.ts: GHL_FIELD_IDS.gr185DemoUrl -> contact.gr185_demo_url.
# Verified live: name "GR-185 Demo URL", dataType TEXT.
DEFAULT_DEMO_URL_FIELD_ID = "uejY9J7kzO4drvb77DKW"

# contact.top_pain_point, id read live 2026-08-15, dataType TEXT.
# T1 of "GR-598 Demo-First Send" opens with:
#     "We looked at your current site, and here's what we found:
#      {{contact.top_pain_point}}"
# The field EXISTS (the platform ETL fills it) but the Klaudius mirror never
# wrote it, so every Klaudius-sourced prospect would have received a first
# email whose first substantive line was blank. GHL renders an unset merge tag
# as empty and still sends - no error, nothing to notice.
DEFAULT_PAIN_POINT_FIELD_ID = "UPQHxESeV2KF5kSs8KxF"

# Gathered-data fields, created live 2026-08-16. /gather collects all of this
# and it used to reach GHL only as prose inside the rep-brief note — readable,
# but not filterable and not usable as a workflow condition. As FIELDS the
# sales team can build a smart list on "industry = pressure washing" or route
# by whether a mobile exists. `website` needs no field here: it is a NATIVE
# GHL contact property and is set directly on the body.
GATHERED_FIELD_IDS = {
    "landline":  "93lxp6fR03MmJL9QWOsA",   # contact.gr_landline
    "facebook":  "GIk7UEcz5pMKr15JAbht",   # contact.gr_facebook
    "instagram": "7CY3KMghhGsIiRN1NdXo",   # contact.gr_instagram
    "industry":  "VOhLZwZR0nEZBZZ1Yxjx",   # contact.gr_industry
}

# stage-automation.ts: SITE_185_OPP_VALUE = 598 one-time + 12 x 98 monthly.
DEFAULT_OPP_VALUE = 1774

# client.ts - the exact UA that gets past Cloudflare.
BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

MAX_ATTEMPTS = 4


class GhlError(RuntimeError):
    """A GHL request failed in a way the caller may want to see."""

    def __init__(self, message: str, status: Optional[int] = None, body: str = ""):
        super().__init__(message)
        self.status = status
        self.body = body


class GhlNotConfigured(GhlError):
    """No API key present. Distinct from a failure so the mirror can stay
    silent-but-honest on an install that has not been wired up yet."""


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def _env(*names: str, default: str = "") -> str:
    for n in names:
        v = os.environ.get(n, "").strip()
        if v:
            return v
    return default


def get_config() -> dict:
    """Resolve mirror config from .env, falling back to the verified ids.

    GHL_API_KEY is the only value that must be supplied - it is a secret and
    belongs in app/.env (gitignored) and nowhere else. The ids all have
    defaults that were read from the live sub-account, so a fresh install
    mirrors into the right pipeline without anyone typing a UUID.
    """
    key = _env("GHL_API_KEY", "GHL_LOCATION_API_KEY")
    return {
        "key": key,
        "location_id": _env("GHL_LOCATION_ID", default=DEFAULT_LOCATION_ID),
        "pipeline_id": _env("GHL_PIPELINE_ID", default=DEFAULT_PIPELINE_ID),
        "stage_id": _env("GHL_STAGE_ID_OUTREACH_SENT", default=DEFAULT_STAGE_ID),
        "demo_url_field_id": _env(
            "GHL_DEMO_URL_FIELD_ID", default=DEFAULT_DEMO_URL_FIELD_ID
        ),
        "pain_point_field_id": _env(
            "GHL_PAIN_POINT_FIELD_ID", default=DEFAULT_PAIN_POINT_FIELD_ID
        ),
        "opp_value": int(_env("GHL_OPP_VALUE", default=str(DEFAULT_OPP_VALUE)) or 0),
        # NOT _env(): that helper treats an empty value as "unset" and returns
        # the default, which would make GHL_DEMO_SENT_TAG= silently re-enable
        # the tag it was meant to switch off. Presence-with-empty is a real
        # signal here, so read os.environ directly and honour "" as "no tag".
        "demo_sent_tag": (
            os.environ["GHL_DEMO_SENT_TAG"].strip()
            if "GHL_DEMO_SENT_TAG" in os.environ
            else DEFAULT_DEMO_SENT_TAG
        ),
        # Explicit off-switch. Absent => mirror when a key exists.
        "enabled": _env("GHL_MIRROR_ENABLED", default="1").lower()
        not in ("0", "false", "no", "off"),
    }


def is_configured() -> bool:
    cfg = get_config()
    return bool(cfg["key"]) and cfg["enabled"]


# ---------------------------------------------------------------------------
# HTTP - ports ghlFetch from client.ts
# ---------------------------------------------------------------------------

_IDEMPOTENT_METHODS = ("GET", "PUT", "DELETE", "HEAD", "OPTIONS")


def _is_retriable_path(method: str, path: str) -> bool:
    """client.ts retries idempotent verbs, plus the two POSTs that GHL itself
    defines as upserts (they dedupe server-side, so a retry cannot double-write).
    A plain POST is never auto-retried."""
    if method in _IDEMPOTENT_METHODS:
        return True
    return "/contacts/upsert" in path or "/opportunities/upsert" in path


def _retry_after_ms(headers: Any) -> Optional[int]:
    raw = None
    try:
        raw = headers.get("Retry-After")
    except Exception:
        return None
    if not raw:
        return None
    try:
        return min(int(float(raw)) * 1000, 5000)
    except (TypeError, ValueError):
        return 5000  # HTTP-date form: don't parse it, just wait the cap


def ghl_fetch(
    path: str,
    method: str = "GET",
    body: Optional[dict] = None,
    with_location: bool = False,
    timeout: int = 30,
) -> Any:
    """Perform one GHL API call, with the headers and retry policy that the
    platform learned the hard way. Returns parsed JSON (or {} on 204)."""
    cfg = get_config()
    if not cfg["key"]:
        raise GhlNotConfigured(
            "GHL_API_KEY is not set. Put the sub-account Private Integration "
            "token in app/.env (gitignored) as GHL_API_KEY=pit-...  Nothing "
            "else in this repo should ever hold it."
        )

    method = method.upper()
    url = path if path.startswith("http") else f"{GHL_API_BASE}{path}"
    payload = dict(body) if body else None

    if with_location:
        if method in ("GET", "DELETE"):
            parts = urllib.parse.urlsplit(url)
            qs = dict(urllib.parse.parse_qsl(parts.query))
            qs.setdefault("locationId", cfg["location_id"])
            url = urllib.parse.urlunsplit(
                (parts.scheme, parts.netloc, parts.path, urllib.parse.urlencode(qs), "")
            )
        else:
            payload = payload or {}
            payload.setdefault("locationId", cfg["location_id"])

    raw = json.dumps(payload).encode("utf-8") if payload is not None else None

    headers = {
        "Authorization": f"Bearer {cfg['key']}",
        "Version": GHL_API_VERSION,
        "Accept": "application/json",
        # Trap 2: without a browser UA, Cloudflare returns a 200 HTML
        # challenge with no data and pagination silently caps at page 1.
        "User-Agent": BROWSER_UA,
    }
    if raw is not None:
        headers["Content-Type"] = "application/json"

    last_exc: Optional[GhlError] = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        req = urllib.request.Request(url, data=raw, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                text = resp.read().decode("utf-8", errors="replace")
                ctype = (resp.headers.get("Content-Type") or "").lower()
                if "json" not in ctype and text.lstrip().lower().startswith("<!doctype"):
                    # Trap 2 again: a 200 that is actually an HTML challenge.
                    raise GhlError(
                        f"GHL returned HTML, not JSON, for {method} {path} - "
                        "this is the Cloudflare challenge. Check the User-Agent header.",
                        status=resp.status,
                        body=text[:400],
                    )
                if not text.strip():
                    return {}
                return json.loads(text)
        except urllib.error.HTTPError as exc:
            text = ""
            try:
                text = exc.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            last_exc = GhlError(
                f"GHL {exc.code} on {method} {path}: {text[:500]}",
                status=exc.code,
                body=text,
            )
            retriable = (exc.code == 429 or exc.code >= 500) and _is_retriable_path(
                method, path
            )
            if not retriable or attempt == MAX_ATTEMPTS:
                raise last_exc
            wait = _retry_after_ms(exc.headers)
            if wait is None:
                wait = min(500 * (2 ** (attempt - 1)), 4000)
            time.sleep((wait + random.randint(0, 250)) / 1000.0)
        except urllib.error.URLError as exc:
            last_exc = GhlError(f"GHL network error on {method} {path}: {exc}")
            if attempt == MAX_ATTEMPTS:
                raise last_exc
            time.sleep((min(500 * (2 ** (attempt - 1)), 4000) + random.randint(0, 250)) / 1000.0)

    raise last_exc or GhlError("unreachable")


# ---------------------------------------------------------------------------
# Identifier sanitizers - ported from identifiers.ts, semantics preserved
# ---------------------------------------------------------------------------

def to_e164_or_none(raw: Any) -> Optional[str]:
    """Normalize a phone to E.164, or None if it cannot be salvaged.

    None means OMIT the phone from the body. GHL 400s the whole upsert on a
    malformed phone, so a junk number must never be sent."""
    if not raw:
        return None
    s = str(raw).strip()
    if not s:
        return None
    has_plus = s.startswith("+")
    digits = re.sub(r"\D", "", s)
    if not digits:
        return None
    if has_plus:
        return f"+{digits}" if 11 <= len(digits) <= 15 else None
    if len(digits) == 10:
        return f"+1{digits}"  # US local
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"  # US with country code
    if 11 <= len(digits) <= 15:
        return f"+{digits}"  # international missing the +
    return None  # too short / unfixable -> omit rather than 400 the upsert


_LOCAL_OK = re.compile(r"^[a-z0-9._%+-]+$")
_DOMAIN_OK = re.compile(r"^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$")
_PHONEY_LOCAL = re.compile(r"^[\d+().\-]+$")


def to_valid_email_or_none(raw: Any) -> Optional[str]:
    """Return a lowercased, validated email, or None if it must be omitted.

    GHL 422s the entire contact upsert on a malformed email, taking the phone
    and every custom field down with it - hence validating independently."""
    if raw is None:
        return None
    if not isinstance(raw, (str, int, float)):
        return None
    s = str(raw).strip().lower()
    if not s:
        return None
    if s.startswith("mailto:"):
        s = s[len("mailto:"):]
    q = s.find("?")
    if q >= 0:
        s = s[:q]
    s = s.strip()
    if not s:
        return None
    if re.search(r"\s", s):
        return None
    at = s.find("@")
    if at <= 0 or at != s.rfind("@"):
        return None  # zero or multiple @, or a leading @
    local, domain = s[:at], s[at + 1:]
    if not local or not domain:
        return None
    if len(s) > 254 or len(local) > 64 or len(domain) > 254:
        return None
    if any(len(label) > 63 for label in domain.split(".")):
        return None
    if not _LOCAL_OK.match(local):
        return None
    if local.startswith(".") or local.endswith(".") or ".." in local:
        return None
    if not _DOMAIN_OK.match(domain):
        return None
    # A phone number pasted into the email column.
    local_digits = re.sub(r"[^\d]", "", local)
    if len(local_digits) >= 7 and _PHONEY_LOCAL.match(local):
        return None
    return s


# Particles that join a compound personal name. Present in Spanish, Portuguese,
# Dutch, German, Italian, Irish and Scottish surnames - all well represented in
# Texas trades, which is the market this pipeline points at.
NAME_PARTICLES = (
    "de", "del", "de la", "la", "las", "los", "da", "das", "dos", "di", "du",
    "van", "von", "der", "den", "ter", "ten", "bin", "ibn", "al", "el",
    "mc", "mac", "st", "st.", "san", "santa", "jr", "jr.", "sr", "sr.", "ii", "iii",
)

BUSINESS_SUFFIXES = (
    "llc", "l.l.c", "inc", "inc.", "incorporated", "ltd", "ltd.", "limited",
    "co", "co.", "corp", "corp.", "company", "plc", "llp", "pllc", "pc",
    "&", "and sons", "group", "services", "service", "solutions",
)


def looks_like_a_business(s: str, business_name: str = "") -> bool:
    """True when this string is a company, not a person.

    /gather sometimes writes the business name into `owner` (a Google listing
    with no named proprietor). Passing that through would put "Bell Plumbing &
    Drain" into firstName/lastName, so the rep greets a company by its first
    word and any {{contact.first_name}} merge renders "Bell".
    """
    t = (s or "").strip().lower()
    if not t:
        return False
    b = (business_name or "").strip().lower()
    if b and (t == b or t in b or b in t):
        return True
    words = t.replace(",", " ").split()
    if any(w.strip(".,") in BUSINESS_SUFFIXES for w in words):
        return True
    # Word count, but only counting SIGNIFICANT words. Naming particles do not
    # make someone a company: "Maria de la Cruz" is four tokens and a real
    # person, and rejecting her would silently drop the names of a large share
    # of Texas trade owners. Middle initials are discounted for the same reason.
    significant = [
        w for w in words
        if w.strip(".,") not in NAME_PARTICLES and len(w.strip(".,")) > 1
    ]
    return len(significant) > 3


def split_owner_name(owner: Any, fallback: str = "") -> tuple[str, str]:
    """Split a scraped owner name into first/last - PERSON NAMES ONLY.

    Returns ("", "") when no genuine person was found. That is deliberate and
    is a change from the original behaviour, which fell back to the business
    name "so a contact is never nameless". The cost of that fallback was worse
    than namelessness: GHL already displays `companyName` when there is no
    person, so the contact is perfectly identifiable, whereas a business name
    sitting in firstName produces "Hi Bell," on a real call and a company name
    inside a {{contact.first_name}} merge field.

    `fallback` is still accepted so callers do not break, but it is now used
    only to RECOGNISE the business name, never to become the person.
    """
    s = (str(owner or "")).strip()
    if not s or looks_like_a_business(s, fallback):
        return ("", "")
    parts = s.split()
    if len(parts) == 1:
        return (parts[0], "")
    return (parts[0], " ".join(parts[1:]))


# ---------------------------------------------------------------------------
# Payload construction - separated from sending so --dry-run shows the truth
# ---------------------------------------------------------------------------

MIRROR_TAG = "klaudius"

# The sales-rep hand-off tag. GHL smart lists are dynamic saved FILTERS, not
# containers - nothing can be "added to" one via the API. The rep's list is
# populated by filtering on something the contact already carries, and this is
# that something: a tag applied at the moment outreach actually went out.
#
# Deliberately NOT reusing MIRROR_TAG. That one answers "which engine sourced
# this lead" and lands on every mirrored row; this one answers "a demo site has
# been emailed to this business, someone should call them" and is the rep's
# entire work queue. Collapsing the two would put un-emailed rows in the queue.
#
# ⚠️ A tag is a WORKFLOW TRIGGER in GHL. This sub-account has 22 published
# workflows and the v2 API does not expose trigger definitions, so it cannot be
# proven from code that nothing enrols on tag-added. Two consequences:
#   1. The default is deliberately specific ("gr598-demo-emailed") rather than a
#      generic word like "demo" or "lead" that an existing workflow might watch.
#   2. Override with GHL_DEMO_SENT_TAG, or set it empty to apply no rep tag at
#      all, if a trigger collision is found in the UI.
# READ FROM THE LIVE WORKFLOW, not chosen by us. Workflow "GR-598 Demo-First
# Send" (be39fdee-05ef-4250-8277-79d7c527cd97) triggers on:
#     Contact tag -> Tag added includes "demo-built"
# and then runs T1 Demo Site Delivered D0 -> Wait -> T2 Nudge D3.
#
# ⚠️ TIMING IS LOAD-BEARING, and the tag NAME is the proof. "demo-built" means
# the demo has been BUILT, not emailed. The workflow itself sends the first
# touch (T1). So this tag must be applied when the site is DEPLOYED, never
# after gmail.py has already sent - doing it at send time makes the prospect
# receive two first-touch emails, one from the mailbox and one from GHL.
#
# That makes the workflow, not gmail.py, the sender for any client carrying
# this tag. Rohan's advice was the opposite (keep the send on the warmed
# mailbox for one-click unsubscribe, threading and the dead-link block).
# Jeff chose the GHL path on 2026-08-15 with that trade-off stated.
DEFAULT_DEMO_SENT_TAG = "demo-built"


def _may_enrol(stage: str) -> bool:
    """True only when applying the demo-built tag is genuinely safe.

    THE TAG IS NOT A LABEL, IT IS A SEND BUTTON. Once "GR-598 Demo-First Send"
    is published, adding `demo-built` to a contact causes GoHighLevel to email
    a real business. So the tag has to answer to the same switch a real send
    does - and it did not, which is the hole this function closes.

    `OUTREACH_ENABLED=false` gates the /outreach skill. It does NOT gate
    /deploy, and the deploy-time mirror lives in update_deployed_url. Without
    this check, deploying a site during an EVALUATION - which is exactly what
    is happening while Klaudius is being trialled - would enrol a real
    business and send it a real email that nobody reviewed.

    Deliberately fail-closed: anything other than an explicit "true" means no
    enrolment. A typo, an unset var or a half-configured install must not send.
    """
    if stage != "deploy":
        return False
    # Who owns the first touch. `ghl` = tag at deploy and let the workflow
    # send; `mailbox` = gmail.py sends and we never apply the trigger tag.
    #
    # This exists because gating the tag on OUTREACH_ENABLED alone recreated
    # the double-send at a different layer: that one switch arms BOTH the
    # /outreach skill (gmail.py) and, via the tag, the GHL workflow. Flipping
    # it would have sent two first-touch emails to the same prospect from two
    # different addresses. The sender is a separate decision from whether
    # sending is on at all, so it gets a separate variable.
    if _env("OUTBOUND_SENDER", default="mailbox").lower() != "ghl":
        return False
    return os.environ.get("OUTREACH_ENABLED", "").strip().lower() == "true"


def owner_from_gathered(slug: str) -> str:
    """Recover the owner name from gathered-content.md.

    /gather DOES find owner names — its skill lists an About checklist item and
    a public-business-registry ladder (Companies House, US Secretary of State
    filings). It writes the result into `gathered-content.md` as a line like:

        - **Owner:** Jessie Trevino (referred to as "Jessie" across reviews)

    Nothing then copies it onto the client row, so `clients.owner` stays NULL
    and the CRM contact arrives with no person on it. Measured 2026-08-16 on
    powerwash-ington: the name was on line 13 of the gathered file while the DB
    column was null. This is a lost handoff, not missing data — and it is
    exactly the fact a paid lead-enrichment product would sell back to us.

    Reads the file rather than the DB deliberately: the file is what /gather
    actually produced, and it is right even when the DB write was skipped.
    """
    try:
        f = ROOT_DIR / "clients" / slug / "data" / "gathered-content.md"
        if not f.exists():
            return ""
        for line in f.read_text(errors="replace").splitlines()[:120]:
            m = re.match(r"^\s*[-*]?\s*\*{0,2}Owner\*{0,2}\s*:\s*(.+)$", line.strip(), re.I)
            if not m:
                continue
            val = m.group(1).strip()
            # Strip a trailing parenthetical gloss: "Jessie Trevino (referred
            # to as ...)" -> "Jessie Trevino".
            val = re.sub(r"\s*\(.*$", "", val).strip()
            val = val.strip("*_ ").strip()
            # Reject non-answers /gather may write when it genuinely found none.
            if not val or val.lower() in {"unknown", "n/a", "na", "not found", "none"}:
                return ""
            return val
    except Exception:  # noqa: BLE001 - never break a mirror over a nicety
        pass
    return ""


def _extra(client: dict) -> dict:
    """`client["extra"]` as a dict, whatever Supabase actually returned.

    jsonb columns come back through this client as a STRING, not a dict, so
    `client["extra"].get("mode")` raises AttributeError on every real row.
    mirror_client() then died and _mirror_to_ghl swallowed it, producing a
    failure alert with no contact and no stack trace. Measured 2026-08-16.
    """
    e = client.get("extra") or {}
    if isinstance(e, str):
        try:
            e = json.loads(e)
        except (json.JSONDecodeError, TypeError):
            return {}
    return e if isinstance(e, dict) else {}


def top_pain_point(client: dict) -> str:
    """The one concrete finding T1 quotes back to the owner.

    Must read as an observation about THEIR business, not a category label:
    T1 renders it directly after "here's what we found:", so "no website"
    lands as an insult while a specific, checkable statement lands as
    homework someone actually did.

    Returns "" when we genuinely have nothing specific. An empty merge tag is
    bad, but inventing a finding is worse - the whole pitch rests on having
    actually looked, and a prospect who spots a fabricated observation is
    gone for good. The caller omits the field entirely when this is empty.
    """
    explicit = (client.get("top_pain_point") or "").strip()
    if explicit:
        return explicit

    name = (client.get("name") or "your business").strip()
    industry = (client.get("industry") or "").strip()
    location = (client.get("location") or "").strip()

    where = f" in {location}" if location else ""
    what = industry or "what you do"
    site = (client.get("website") or "").strip()

    # PIPELINE_MODES is classic,rescue,booking - THREE lead streams, and each
    # needs its own observation. An earlier version handled only the classic
    # (no-website) case and returned "" for everything else, which would have
    # rendered T1's key line BLANK for every rescue and booking lead - i.e. for
    # exactly the Tier B prospects GR-185 targets on purpose, because Tier A
    # (no website at all) is an email dead end.
    #
    # `extra.mode` and `extra.site_signals` are stamped by /find at claim time
    # (see find/SKILL.md Rescue mode). Fall back to inferring from `website`
    # when a row predates that stamping.
    extra = _extra(client)
    mode = (extra.get("mode") or "").strip().lower()
    if not mode:
        mode = "classic" if not site else "rescue"

    if mode == "booking":
        return (
            f"the only web presence I could find for {name} is a booking page "
            f"on someone else's platform, so you are paying for software that "
            f"sends people somewhere that is not yours."
        )

    # OPERATOR-SEEDED / verdict "ok": the business has a perfectly good site.
    # site-check.js returned no faults, so there is nothing honest to criticise
    # — and inventing one is the single fastest way to lose the reader, since
    # they can see their own site. /find would never surface this lead (`ok`
    # disqualifies), so this case only arises when the operator points the
    # builder at a URL deliberately: a referral, an existing client, a demo.
    #
    # The pitch therefore CANNOT be "your site is broken". It has to be the
    # honest one: this is a second option to compare, built free, no strings.
    if mode in ("operator", "ok", "compete") or (site and extra.get("site_verdict") == "ok"):
        # NOT an apology, and never a fake criticism. A business with a good
        # site is still PAYING somebody, and often more than $98/mo for less.
        # Jeff, 2026-08-15: "i would try to take that client all day." So the
        # observation is about what they are getting for what they pay, which
        # is true, checkable and does not insult work they can see is fine.
        # (No em dash: the anti-slop rules ban it and this string ships.)
        return (
            f"your site at {site} is genuinely fine, so this is not me telling "
            f"you it is broken. I built a second one to sit next to it because "
            f"most people paying an agency monthly are not getting hosting, a "
            f"chat assistant, 20 blog posts a month and ongoing SEO for $98."
        )

    if mode == "rescue" and site:
        # site_signals comes from scripts/site-check.js - concrete, checkable
        # faults ("no-https, no-viewport-meta"), never a judgement by eye.
        signals = (extra.get("site_signals") or "").strip()
        readable = {
            "no-https": "it is not on a secure connection, so browsers warn people off it",
            "no-viewport-meta": "it does not work properly on a phone",
            "dead": "it does not load at all",
            "placeholder": "it is still showing a hosting placeholder",
        }
        faults = [readable[k] for k in
                  [x.strip() for x in signals.split(",") if x.strip()]
                  if k in readable]
        if faults:
            return (
                f"{name} has a site at {site}, but " + " and ".join(faults[:2]) + "."
            )
        return (
            f"{name} has a site at {site}, but it is not doing you any favours "
            f"when someone searching for {what}{where} lands on it."
        )

    if not site:
        return (
            f"{name} has no website of its own, so when someone searches for "
            f"{what}{where} there is nothing of yours for them to land on."
        )
    return ""


def build_rep_brief(client: dict) -> str:
    """The pre-call brief a salesperson actually reads before dialling.

    /gather collects far more than a contact record can hold - landline AND
    mobile, Facebook, Instagram, rating and review count, hours, the industry,
    the state of any existing site. Spreading that across fifteen new custom
    fields makes the CRM unreadable and means every field has to be explained
    to whoever picks up the phone. A single note keeps it scannable and needs
    no schema change.

    Only ever states what was actually gathered. A missing value is omitted,
    never guessed and never filled with "N/A" padding - a rep who spots one
    invented detail stops trusting the whole brief, and the pitch depends on
    us having genuinely looked.
    """
    L = []
    name = (client.get("name") or client.get("slug") or "this business").strip()
    L.append(f"GR-598 DEMO BUILT - {name}")

    industry = (client.get("industry") or "").strip()
    location = (client.get("location") or "").strip()
    if industry or location:
        L.append(" ".join(x for x in (industry, f"in {location}" if location else "") if x))

    demo = (client.get("deployed_url") or "").strip()
    if demo:
        L.append("")
        L.append(f"DEMO SITE: {demo}")

    # Reach - every channel we found, so the rep is not left guessing which
    # number is the mobile and which is the desk phone.
    reach = []
    for label, key in (("Mobile", "phone"), ("Landline", "landline"),
                       ("Email", "email"), ("Website", "website"),
                       ("Facebook", "facebook"), ("Instagram", "instagram")):
        v = (client.get(key) or "").strip()
        if v:
            reach.append(f"  {label}: {v}")
    if reach:
        L.append("")
        L.append("REACH")
        L.extend(reach)

    owner = (client.get("owner") or "").strip()
    if owner:
        L.append("")
        L.append(f"OWNER: {owner}")

    # Social proof - what the pitch leans on, and what the rep can reference.
    rating = client.get("rating")
    reviews = client.get("review_count") or client.get("reviews")
    if rating or reviews:
        bits = []
        if rating:
            bits.append(f"{rating} stars")
        if reviews:
            bits.append(f"{reviews} reviews")
        L.append("")
        L.append("GOOGLE: " + ", ".join(bits))

    addr = (client.get("address") or "").strip()
    if addr:
        L.append("")
        L.append(f"ADDRESS: {addr}")

    pain = top_pain_point(client)
    if pain:
        L.append("")
        L.append("WHY WE BUILT IT")
        L.append(f"  {pain}")

    # The mode tells the rep what the prospect currently has, which changes the
    # conversation completely: no site at all vs a bad one vs a booking page.
    extra = _extra(client)
    mode = (extra.get("mode") or "").strip()
    signals = (extra.get("site_signals") or "").strip()
    if mode:
        line = f"LEAD TYPE: {mode}"
        if signals:
            line += f" ({signals})"
        L.append("")
        L.append(line)

    notes = (client.get("notes") or "").strip()
    if notes:
        L.append("")
        L.append("GATHER NOTES")
        L.append(f"  {notes}")

    return "\n".join(L)


def attach_rep_brief(contact_id: str, client: dict) -> bool:
    """POST the brief as a contact note. Best-effort, never raises."""
    body = build_rep_brief(client)
    if not body.strip():
        return False
    try:
        ghl_fetch(f"/contacts/{contact_id}/notes", method="POST", body={"body": body})
        return True
    except GhlError as exc:
        print(f"rep brief note failed for {client.get('slug')}: {exc}", file=sys.stderr)
        return False


def build_contact_payload(
    client: dict, cfg: Optional[dict] = None, stage: str = "deploy"
) -> dict:
    """Build the exact /contacts/upsert body for a Klaudius client row.

    Raises GhlError when neither a valid email nor a valid phone survives -
    that is the documented "do not attempt the upsert at all" case.
    """
    cfg = cfg or get_config()
    email = to_valid_email_or_none(client.get("email"))
    phone = to_e164_or_none(client.get("phone")) or to_e164_or_none(
        client.get("landline")
    )

    if not email and not phone:
        raise GhlError(
            f"no valid email or phone for {client.get('slug')!r} - contact "
            "upsert not attempted (GHL would 422/400 the whole request)"
        )

    # Fall back to the gathered file when the DB row has no owner — the name
    # is frequently there and simply never copied across.
    owner = (client.get("owner") or "").strip() or owner_from_gathered(client.get("slug", ""))
    first, last = split_owner_name(owner, fallback=client.get("name", ""))

    body: dict[str, Any] = {
        "locationId": cfg["location_id"],
        "firstName": first,
        "lastName": last,
        # Tag every mirrored row. Two lanes write into this sub-account
        # (the platform ETL and this one); without the tag they are
        # indistinguishable and nobody can tell which engine sourced a lead.
        # The demo-built tag is applied ONLY at stage="deploy". That tag is the
        # trigger for "GR-598 Demo-First Send", which sends the prospect's first
        # email itself - so it must land when the site goes live, before anyone
        # has written to them. Applying it again at stage="outreach_sent" would
        # be at best a no-op (GHL fires "tag added" only on an actual change)
        # and at worst a second first-touch email. Provenance tag always.
        "tags": [
            t
            for t in (
                MIRROR_TAG,
                cfg.get("demo_sent_tag") if _may_enrol(stage) else None,
            )
            if t
        ],
        "source": "Klaudius outreach",
    }
    if email:
        body["email"] = email
    if phone:
        body["phone"] = phone
    if client.get("name"):
        body["companyName"] = client["name"]

    # Native GHL contact fields. These exist on every location with no schema
    # change, so prefer them over inventing custom fields the rep then has to
    # be told about. /gather collects all of this; the mirror used to drop it.
    if client.get("address"):
        body["address1"] = client["address"]
    for src, dst in (("website", "website"), ("city", "city"),
                     ("state", "state"), ("postal_code", "postalCode"),
                     ("country", "country")):
        v = (client.get(src) or "").strip() if isinstance(client.get(src), str) else client.get(src)
        if v:
            body[dst] = v

    # Split a "City, ST" location into city/state when they were not captured
    # separately - the common shape coming out of Google Places.
    loc = (client.get("location") or "").strip()
    if loc and not body.get("city"):
        parts = [x.strip() for x in loc.split(",")]
        if parts and parts[0]:
            body["city"] = parts[0]
        if len(parts) > 1 and parts[1] and not body.get("state"):
            body["state"] = parts[1]

    # Trap 1: BY ID, and `field_value` not `value`.
    demo_url = (client.get("deployed_url") or "").strip()
    fields = []
    if demo_url:
        fields.append({"id": cfg["demo_url_field_id"], "field_value": demo_url})

    # Every gathered fact we have a field for. Omitted when absent: an empty
    # string asserts a value of "" and is worse than the field simply not
    # being set, which is what a smart-list filter actually tests for.
    for _key, _fid in GATHERED_FIELD_IDS.items():
        _v = client.get(_key)
        _v = _v.strip() if isinstance(_v, str) else _v
        if _v:
            fields.append({"id": _fid, "field_value": str(_v)})
    pain = top_pain_point(client)
    if pain:
        fields.append({"id": cfg["pain_point_field_id"], "field_value": pain})
    # Internal build cost. Custom fields are team-only inside the CRM, so this
    # sits next to the opportunity value without ever reaching the client.
    # Deferred import + swallow: cost tracking must never break a mirror.
    try:
        import cost_ledger  # noqa: PLC0415

        fields.extend(cost_ledger.ghl_custom_fields(client.get("slug", "")))
    except Exception:  # noqa: BLE001
        pass
    if fields:
        body["customFields"] = fields
    return body


def build_opportunity_payload(
    client: dict, contact_id: str, cfg: Optional[dict] = None
) -> dict:
    cfg = cfg or get_config()
    return {
        "locationId": cfg["location_id"],
        "pipelineId": cfg["pipeline_id"],
        "pipelineStageId": cfg["stage_id"],
        "contactId": contact_id,
        "name": client.get("name") or client.get("slug") or "Klaudius prospect",
        "status": "open",
        "monetaryValue": cfg["opp_value"],
    }


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------

def upsert_contact(client: dict, stage: str = "deploy") -> dict:
    """POST /contacts/upsert. Returns {'id', 'new', 'raw'}.

    Carries the platform's self-heal: if GHL 422s specifically because it
    dislikes the email, retry once phone-only rather than losing the row."""
    cfg = get_config()
    body = build_contact_payload(client, cfg, stage)
    try:
        res = ghl_fetch("/contacts/upsert", method="POST", body=body)
    except GhlError as exc:
        rejected_email = (
            exc.status == 422
            and re.search(r"email must be an email", exc.body or "", re.I)
            and "email" in body
            and "phone" in body
        )
        if not rejected_email:
            raise
        body.pop("email", None)
        res = ghl_fetch("/contacts/upsert", method="POST", body=body)

    contact = res.get("contact") if isinstance(res, dict) else None
    contact_id = (contact or {}).get("id") or (res or {}).get("id")
    if not contact_id:
        raise GhlError(f"contact upsert returned no id: {json.dumps(res)[:400]}")
    return {"id": contact_id, "new": (res or {}).get("new"), "raw": res}


def upsert_opportunity(client: dict, contact_id: str) -> dict:
    """POST /opportunities/upsert. GHL dedupes on
    (locationId, pipelineId, contactId), so a re-fire updates in place instead
    of littering the pipeline with duplicates."""
    body = build_opportunity_payload(client, contact_id)
    res = ghl_fetch("/opportunities/upsert", method="POST", body=body)
    opp = res.get("opportunity") if isinstance(res, dict) else None
    opp_id = (opp or {}).get("id") or (res or {}).get("id")
    if not opp_id:
        raise GhlError(f"opportunity upsert returned no id: {json.dumps(res)[:400]}")
    return {"id": opp_id, "new": (res or {}).get("new"), "raw": res}


def mirror_client(
    client: dict, dry_run: bool = False, stage: str = "deploy"
) -> dict:
    """Mirror one client row into GHL. Never raises - returns a result dict.

    This is the function the pipeline calls. A GHL problem must degrade to a
    warning, never to a lost send: Supabase already holds the real record by
    the time this runs.
    """
    cfg = get_config()
    slug = client.get("slug", "?")

    if not cfg["key"]:
        return {"ok": False, "skipped": "not_configured", "slug": slug,
                "detail": "GHL_API_KEY not set in app/.env"}
    if not cfg["enabled"]:
        return {"ok": False, "skipped": "disabled", "slug": slug,
                "detail": "GHL_MIRROR_ENABLED is off"}

    try:
        contact_body = build_contact_payload(client, cfg, stage)
    except GhlError as exc:
        return {"ok": False, "skipped": "no_valid_identifier", "slug": slug,
                "detail": str(exc)}

    if not (client.get("deployed_url") or "").strip():
        print(
            f"WARN: {slug} has no deployed_url - mirroring the contact without "
            f"the GR-185 Demo URL custom field.",
            file=sys.stderr,
        )

    if dry_run:
        return {
            "ok": True,
            "dry_run": True,
            "slug": slug,
            "contact_payload": contact_body,
            "opportunity_payload": build_opportunity_payload(
                client, "<contact_id from upsert>", cfg
            ),
        }

    try:
        contact = upsert_contact(client, stage)
    except GhlError as exc:
        return {"ok": False, "slug": slug, "stage": "contact", "error": str(exc)}

    # Attach the rep brief before the opportunity, so a failure there still
    # leaves a contact somebody can actually work.
    attach_rep_brief(contact["id"], client)

    try:
        opp = upsert_opportunity(client, contact["id"])
    except GhlError as exc:
        return {"ok": False, "slug": slug, "stage": "opportunity",
                "contact_id": contact["id"], "error": str(exc)}

    return {
        "ok": True,
        "slug": slug,
        # Did this contact actually enter GR-598 Demo-First Send? The operator
        # alert says "sequence started" only when this is True, because a
        # contact that mirrored fine but did not enrol sends NOTHING - and a
        # success alert that glosses over that is worse than no alert.
        "enrolled": bool(_may_enrol(stage) and cfg.get("demo_sent_tag")),
        "contact_id": contact["id"],
        "contact_new": contact.get("new"),
        "opportunity_id": opp["id"],
        "demo_url": (client.get("deployed_url") or "") or None,
    }


def mirror_outreach_sent(slug: str, dry_run: bool = False) -> dict:
    """Mirror by slug - reads the row Supabase already wrote.

    Deliberately re-reads rather than trusting a caller-supplied dict, so the
    mirror can never disagree with the source of truth.
    """
    from db import get_client_by_slug  # local import: db.py imports this module

    client = get_client_by_slug(slug)
    if not client:
        return {"ok": False, "slug": slug, "skipped": "client_not_found"}
    return mirror_client(client, dry_run=dry_run)


# ---------------------------------------------------------------------------
# Reads (verification)
# ---------------------------------------------------------------------------

def get_contact(contact_id: str) -> dict:
    res = ghl_fetch(f"/contacts/{contact_id}")
    return res.get("contact", res)


def find_contact_by_email(email: str) -> Optional[dict]:
    valid = to_valid_email_or_none(email)
    if not valid:
        return None
    qs = urllib.parse.urlencode({"email": valid})
    res = ghl_fetch(f"/contacts/lookup?{qs}", with_location=True)
    contacts = (res or {}).get("contacts") or []
    return contacts[0] if contacts else None


def find_opportunities_for_contact(contact_id: str) -> list:
    cfg = get_config()
    qs = urllib.parse.urlencode(
        {"location_id": cfg["location_id"], "contact_id": contact_id, "limit": 20}
    )
    res = ghl_fetch(f"/opportunities/search?{qs}")
    return (res or {}).get("opportunities") or []


def doctor() -> int:
    """Verify credentials and ids without writing anything."""
    cfg = get_config()
    print("=== GHL mirror doctor ===")
    print(f"  location_id      : {cfg['location_id']}")
    print(f"  pipeline_id      : {cfg['pipeline_id']}")
    print(f"  stage_id         : {cfg['stage_id']}")
    print(f"  demo_url_field_id: {cfg['demo_url_field_id']}")
    print(f"  opportunity value: {cfg['opp_value']}")
    print(f"  mirror enabled   : {cfg['enabled']}")
    if not cfg["key"]:
        print("  api key          : MISSING")
        print("\nFAIL: set GHL_API_KEY=pit-... in app/.env (gitignored).")
        return 1
    print(f"  api key          : present ({cfg['key'][:4]}..., {len(cfg['key'])} chars)")
    if not cfg["key"].startswith("pit-"):
        print("\nWARN: the platform's loader requires a token starting with 'pit-' "
              "(a sub-account Private Integration token). This one does not.")

    ok = True
    try:
        loc = ghl_fetch(f"/locations/{cfg['location_id']}")
        name = (loc.get("location") or loc).get("name")
        print(f"\n  location verified: {name!r}")
    except GhlError as exc:
        print(f"\n  location FAILED  : {exc}")
        return 1

    try:
        pipes = ghl_fetch("/opportunities/pipelines", with_location=True)
        found = next(
            (p for p in (pipes.get("pipelines") or []) if p.get("id") == cfg["pipeline_id"]),
            None,
        )
        if not found:
            print(f"  pipeline FAILED  : {cfg['pipeline_id']} not in this location")
            ok = False
        else:
            stage = next(
                (s for s in (found.get("stages") or []) if s.get("id") == cfg["stage_id"]),
                None,
            )
            print(f"  pipeline verified: {found.get('name')!r}")
            if stage:
                print(f"  stage verified   : {stage.get('name')!r} (position {stage.get('position')})")
            else:
                print(f"  stage FAILED     : {cfg['stage_id']} not in that pipeline")
                ok = False
    except GhlError as exc:
        print(f"  pipeline FAILED  : {exc}")
        ok = False

    try:
        fields = ghl_fetch(
            f"/locations/{cfg['location_id']}/customFields?model=contact"
        )
        cf = next(
            (f for f in (fields.get("customFields") or [])
             if f.get("id") == cfg["demo_url_field_id"]),
            None,
        )
        if cf:
            print(f"  demo-url field   : {cf.get('name')!r} key={cf.get('fieldKey')!r}")
            if cf.get("fieldKey") != "contact.gr185_demo_url":
                print("  WARN: fieldKey is not contact.gr185_demo_url - check the id.")
        else:
            print(f"  demo-url FAILED  : {cfg['demo_url_field_id']} not found")
            ok = False
    except GhlError as exc:
        print(f"  demo-url FAILED  : {exc}")
        ok = False

    print("\nOK - mirror is wired correctly." if ok else "\nFAIL - see above.")
    return 0 if ok else 1


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _cmd_show(slug: str) -> int:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from db import get_client_by_slug

    client = get_client_by_slug(slug)
    if not client:
        print(f"No such client: {slug}", file=sys.stderr)
        return 1
    contact = None
    email = to_valid_email_or_none(client.get("email"))
    if email:
        contact = find_contact_by_email(email)
    if not contact:
        print(f"No GHL contact found for {slug} (email={email})")
        return 1
    print("=== GHL CONTACT ===")
    print(json.dumps(contact, indent=2)[:4000])
    print("\n=== GHL OPPORTUNITIES ===")
    print(json.dumps(find_opportunities_for_contact(contact["id"]), indent=2)[:4000])
    return 0


def main() -> int:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    cmd = args[0]

    if cmd == "doctor":
        return doctor()

    if cmd == "mirror":
        if len(args) < 2:
            print("usage: ghl.py mirror SLUG [--dry-run]", file=sys.stderr)
            return 2
        result = mirror_outreach_sent(args[1], dry_run="--dry-run" in args)
        print(json.dumps(result, indent=2))
        return 0 if result.get("ok") else 1

    if cmd == "show":
        if len(args) < 2:
            print("usage: ghl.py show SLUG", file=sys.stderr)
            return 2
        return _cmd_show(args[1])

    print(f"unknown command: {cmd}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
