#!/usr/bin/env python3
"""
ms_oauth.py - Microsoft OAuth 2.0 sign-in + token store for Outlook / Microsoft 365 mailboxes.

Microsoft permanently retired app-password (basic auth) access to Outlook.com
and Microsoft 365 mailboxes, so unlike every other provider Klaudius supports,
an Outlook mailbox cannot be driven over IMAP/SMTP with EMAIL_PASSWORD. This
module implements the replacement: OAuth 2.0 device-code sign-in against the
Microsoft identity platform, with tokens cached locally and refreshed
automatically. scripts/mail_graph.py uses these tokens to send and read mail
through the Microsoft Graph API.

Enabled by `EMAIL_AUTH=oauth-microsoft` in .env (the init wizard sets this when
you pick Outlook / Microsoft 365). EMAIL_PASSWORD / SMTP / IMAP settings are
not used in this mode.

Usage:
  python3 scripts/ms_oauth.py login                # one-time sign-in (browser opens itself)
  python3 scripts/ms_oauth.py login --device-code  # force the code-based flow (remote/headless)
  python3 scripts/ms_oauth.py status               # is a working sign-in present?
  python3 scripts/ms_oauth.py logout               # delete the local token cache

How it works:
  - `login` opens your browser to Microsoft's sign-in page and waits; you sign
    in as the mailbox configured as EMAIL_ADDRESS, approve, and the terminal
    picks it up automatically (authorization-code flow with PKCE over a
    localhost loopback). No password ever passes through Klaudius.
  - If the browser can't be opened here (SSH, headless box), it falls back to
    the code-based flow: a microsoft.com/devicelogin URL plus a short code you
    enter from ANY device. NOTE this fallback is being disabled by default
    across Microsoft business tenants (the Microsoft-managed "Block device
    code flow" Conditional Access policy, rolling out since Feb 2025 — shows
    as "your sign-in was successful but does not meet the criteria"). That's
    exactly why the browser flow is the primary.
  - Tokens land in .ms-token.json next to .env (gitignored, chmod 600). The
    refresh token lets every later run get fresh access tokens silently —
    you sign in once, not per run.
  - The app identity (client ID below) is Klaudius's public registration in
    Microsoft's identity platform. It is a public identifier, not a secret:
    tokens are issued to YOUR sign-in on YOUR machine, and only the delegated
    scopes below are ever requested (read/write your mail, send as you).

If a run ever reports that the sign-in expired (e.g. the mailbox password was
changed, or an admin revoked sessions), re-run `login`. Everything else
recovers automatically.
"""

# Trust the OS root-CA store before any TLS negotiation — same reason as
# gmail.py (corporate proxies / antivirus that MITM HTTPS break requests'
# bundled CA list otherwise). No-op where there's no interception.
try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

import base64
import hashlib
import json
import os
import secrets
import sys
import tempfile
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

# Never let a status glyph kill a run. On Windows, Python writing to a PIPE
# (doctor captures `status` output that way; operators redirect too) encodes
# with the locale codepage — cp1252 can't represent "✓"/"⚠", so the SUCCESS
# print would raise UnicodeEncodeError: sign-in works, then the process dies
# at the moment it says so, and doctor reports a healthy install as broken.
# errors="replace" degrades the glyph to '?' instead. Console output is
# unaffected (PEP 528 consoles are UTF-8).
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(errors="replace")
    except Exception:
        pass

try:
    import requests
except ImportError:
    print(
        "ERROR: the 'requests' package is required for Microsoft OAuth "
        "(pip install requests — normally installed by `npx klaudius install`).",
        file=sys.stderr,
    )
    sys.exit(1)

# Klaudius's app registration (Cloudbot Limited tenant). Public client — there
# is no secret. Overridable for testing against a different registration.
CLIENT_ID = os.environ.get("MS_OAUTH_CLIENT_ID", "97fcc3be-95fe-401f-bbef-5a2e5aad6f48")

# /common signs in both organisational (Microsoft 365 / Exchange Online) and
# personal (outlook.com / hotmail) accounts — matching the app registration's
# "Any Entra ID tenant + personal Microsoft accounts" audience.
AUTHORITY = "https://login.microsoftonline.com/common"
AUTHORIZE_URL = f"{AUTHORITY}/oauth2/v2.0/authorize"
DEVICE_CODE_URL = f"{AUTHORITY}/oauth2/v2.0/devicecode"
TOKEN_URL = f"{AUTHORITY}/oauth2/v2.0/token"

# Delegated scopes only — the app acts as the signed-in operator, never as a
# standing service. offline_access = refresh tokens (sign in once, not per
# run); User.Read = identify the signed-in mailbox (GET /me) so we can catch
# wrong-account sign-ins.
SCOPES = (
    "https://graph.microsoft.com/Mail.ReadWrite "
    "https://graph.microsoft.com/Mail.Send "
    "https://graph.microsoft.com/User.Read "
    "offline_access"
)

GRAPH_BASE = "https://graph.microsoft.com/v1.0"

# Token cache lives next to .env at the project root: same trust boundary as
# the credentials file it replaces, covered by the same "never commit" rules.
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
TOKEN_PATH = Path(os.environ.get("MS_OAUTH_TOKEN_PATH", _PROJECT_ROOT / ".ms-token.json"))

# Refresh when under this many seconds of access-token life remain. Access
# tokens live ~60-90 min; refreshing early means a token can't expire mid-run.
_REFRESH_SKEW = 300


def load_env():
    env_path = _PROJECT_ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                    value = value[1:-1]
                os.environ.setdefault(key.strip(), value)


load_env()


class MsAuthError(RuntimeError):
    """Raised when no usable token can be produced. Message is operator-facing."""


def _post(url, data, timeout=30):
    """POST with network failures translated into operator-readable errors.

    requests raises ConnectionError/Timeout/SSLError, none of which are
    MsAuthError or RuntimeError — so unwrapped they escaped every caller's
    handler and reached a non-technical buyer as a Python traceback (during
    `klaudius init`, or as doctor's detail line, which then paired
    "Traceback (most recent call last):" with the advice "run login").
    """
    try:
        return requests.post(url, data=data, timeout=timeout)
    except requests.RequestException as e:
        raise MsAuthError(
            "Couldn't reach Microsoft to sign in. Check your internet connection "
            f"(and any corporate proxy or VPN), then try again. [{type(e).__name__}]"
        ) from e


def _load_cache():
    """Parsed token cache, or None when absent/unreadable.

    A corrupt cache is reported distinctly from a missing one: both need the
    same fix (sign in again), but "no sign-in found" sends support down the
    wrong path when the real story is a truncated file.

    Windows raises PermissionError here for a reason that has nothing to do
    with corruption: a sibling process is mid-write and holds the file, so
    the open is refused. Treating that as "signed out" is wrong and was
    observed on real Windows CI — a valid, signed-in operator would be told
    to authenticate again purely because another session wrote at that
    instant. Retry briefly before believing it; a genuinely corrupt file
    still fails every attempt and reports honestly.
    """
    deadline = time.monotonic() + 5.0
    delay = 0.02
    while True:
        try:
            with open(TOKEN_PATH) as f:
                return json.load(f)
        except FileNotFoundError:
            # Unambiguous: no cache. Note this is NOT reachable during the
            # writer's os.replace, which is atomic — a reader sees either the
            # old file or the new one, never a gap.
            return None
        except PermissionError as e:
            # Windows-only sharing violation; inert on POSIX.
            if time.monotonic() >= deadline:
                print(f"WARNING: token cache at {TOKEN_PATH} stayed locked by "
                      f"another process ({e}); treating as signed out.",
                      file=sys.stderr)
                return None
            time.sleep(delay + secrets.randbelow(20) / 1000.0)
            delay = min(delay * 2, 0.25)
        except (OSError, ValueError) as e:
            print(f"WARNING: token cache at {TOKEN_PATH} is unreadable ({e}); "
                  "treating as signed out.", file=sys.stderr)
            return None


def _save_cache(data):
    """Write the token cache atomically.

    A plain open(..., "w") truncates the file before the new bytes land, so a
    concurrent reader can see an empty or half-written file and conclude
    there's no sign-in at all. That matters here because the pipeline's
    parallel mode runs several sessions against this one cache at the same
    time (see prompts/parallel-run.md) — a torn read would surface as a
    spurious "no Microsoft sign-in found" in a child that is perfectly
    authenticated, and a crash mid-write would corrupt the cache for good.
    """
    # mkstemp, not a PID-derived name: it guarantees a unique file even when
    # two writers share a PID (threads), and creates it 0600 from the outset
    # so the refresh token is never briefly world-readable. A shared temp
    # name would let one writer rename a file another is still writing into
    # — reintroducing exactly the torn read this function exists to prevent.
    fd, tmp = tempfile.mkstemp(dir=str(TOKEN_PATH.parent), prefix=f".{TOKEN_PATH.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=2)
        # Atomic on POSIX and Windows — but on WINDOWS os.replace raises
        # PermissionError if the destination is momentarily open by another
        # process, which the parallel-run mode makes reachable (several
        # sessions share this one cache). Unhandled, that would escape as a
        # raw traceback out of a token refresh and abort a pipeline child.
        # Retry briefly; the holder is only ever mid-read, so the window is
        # tiny.
        # Budget is a DEADLINE, not an attempt count: 5 fixed 0.1s attempts
        # gave up after half a second, and real Windows CI showed that losing
        # ~1% of writes under contention (4 readers, 4 writers). Losing a
        # write here is not cosmetic — the write that matters most is the one
        # storing a freshly ROTATED refresh token, and Microsoft invalidates
        # the old one, so dropping it silently logs the operator out and they
        # must sign in again by hand.
        #
        # Backoff is exponential with jitter: several pipeline sessions hit
        # this file at once, and a fixed delay makes them retry in lockstep
        # forever. secrets (already imported) rather than random, so this
        # can't perturb a seeded RNG elsewhere in the process.
        deadline = time.monotonic() + 10.0
        delay = 0.02
        while True:
            try:
                os.replace(tmp, TOKEN_PATH)
                break
            except PermissionError:
                # Windows only: raised while ANOTHER process holds the
                # destination open, even just for reading. POSIX never gets
                # here, so this loop is inert everywhere else.
                if time.monotonic() >= deadline:
                    raise
                time.sleep(delay + secrets.randbelow(20) / 1000.0)
                delay = min(delay * 2, 0.25)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def _store_token_response(tok, prior=None):
    """Normalise a /token response into the cache shape and persist it.

    Microsoft rotates refresh tokens: each refresh response may carry a new
    one, and the old one eventually stops working. Always keep the newest;
    fall back to the prior one only when the response omits it.
    """
    cache = {
        "access_token": tok["access_token"],
        "expires_at": time.time() + int(tok.get("expires_in", 3600)),
        "refresh_token": tok.get("refresh_token") or (prior or {}).get("refresh_token"),
        "scope": tok.get("scope", ""),
        "account": (prior or {}).get("account"),
    }
    _save_cache(cache)
    return cache


# ---------------------------------------------------------------------------
# Primary sign-in: authorization-code + PKCE over a localhost loopback.
#
# This is the standard native-app flow: we open the system browser to
# Microsoft's sign-in page with a one-shot redirect to http://localhost:<port>,
# catch the authorization code on a throwaway local listener, and exchange it
# (with the PKCE verifier, so an intercepted code is useless) for tokens.
#
# It replaced device-code flow as the primary for one hard reason: Microsoft
# has been auto-deploying a managed Conditional Access policy — "Block device
# code flow" — to business tenants since Feb 2025 (Secure Future Initiative;
# report-only, then auto-ON ~45 days later, targeting tenants with no recent
# device-code usage, i.e. virtually all of them). The first real Outlook buyer
# hit it on day one: sign-in succeeds, then "does not meet the criteria to
# access this resource", and nothing the buyer or we could consent to fixes
# it. The browser flow is an ordinary interactive sign-in and is not touched
# by that policy. Device-code remains only as the SSH/headless fallback.
# ---------------------------------------------------------------------------

# Seconds to wait for the browser round-trip. Deliberately as long as a
# device code's lifetime: a first-timer setting up MFA mid-sign-in can easily
# take >5 minutes, and cutting them off would drop to the device-code
# fallback — which is CA-blocked on exactly the tenants the browser flow
# exists to serve. Ctrl+C skips the wait at any time.
_LOOPBACK_TIMEOUT = 900


class _LoopbackUnavailable(Exception):
    """Loopback flow couldn't run/complete here (no browser, nothing came
    back). Signal to fall back to device-code — NOT an auth failure."""


_TEXT_BROWSERS = {"lynx", "w3m", "links", "links2", "elinks", "www-browser"}


def _graphical_browser_available():
    """Can webbrowser.open() plausibly reach a GRAPHICAL browser here?

    Calling it blind is dangerous on headless Linux: CPython registers text
    browsers (lynx/w3m/links/elinks) whenever TERM is set, and GenericBrowser
    .open() BLOCKS until the browser exits — so an SSH'd VPS with w3m present
    would launch a text browser INTO the operator's terminal, on a JS-only
    Microsoft page it can never render, before our own timeout even starts.
    That machine should go straight to the device-code fallback instead.
    """
    if sys.platform in ("darwin", "win32"):
        return True
    if os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"):
        return True
    browser_env = os.path.basename(os.environ.get("BROWSER", "").split()[0]) if os.environ.get("BROWSER") else ""
    if browser_env and browser_env not in _TEXT_BROWSERS:
        return True  # explicitly configured (e.g. wslview on WSL)
    return False


def _pkce_pair():
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    return verifier, challenge


class _CallbackHandler(BaseHTTPRequestHandler):
    """One-shot handler for Microsoft's redirect back to localhost."""

    # Per-CONNECTION deadline. Without it, one silent TCP connect — a browser
    # speculative preconnect, or an EDR agent port-scanning localhost, both
    # routine on managed Windows machines — blocks handle_one_request() in a
    # readline() forever: server.timeout only bounds waiting for NEW
    # connections, not accepted ones. Reproduced: a connect-and-send-nothing
    # socket wedged the whole login past its deadline AND starved the real
    # callback. StreamRequestHandler applies this via settimeout(); the
    # resulting TimeoutError closes just that connection and the wait loop
    # carries on.
    timeout = 5

    def log_message(self, *args):  # silence per-request stderr noise
        pass

    def do_GET(self):
        qs = parse_qs(urlparse(self.path).query)
        state_ok = qs.get("state", [None])[0] == self.server.expected_state
        if ("code" in qs or "error" in qs) and state_ok:
            self.server.auth_result = {k: v[0] for k, v in qs.items()}
            body = (
                "<html><body style='font-family:sans-serif;margin:15% auto;max-width:28em;text-align:center'>"
                "<h2>Signed in ✓</h2><p>You can close this tab and go back to your terminal.</p>"
                "</body></html>"
            )
        else:
            # favicon probes, stray requests, state mismatch: answer politely,
            # keep waiting for the real callback.
            body = "<html><body></body></html>"
        data = body.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def interactive_login(quiet=False):
    """Browser-based sign-in (the primary). `quiet` suppresses only the
    success line — the instructions and URLs always print, because they ARE
    the interface. Raises _LoopbackUnavailable when
    the flow can't complete HERE (headless box, browser never came back) so
    the caller can drop to device-code; raises MsAuthError for real refusals.
    """
    verifier, challenge = _pkce_pair()
    state = secrets.token_urlsafe(16)

    server = HTTPServer(("127.0.0.1", 0), _CallbackHandler)
    server.expected_state = state
    server.auth_result = None
    server.timeout = 1  # so the wait loop can watch the clock
    port = server.server_address[1]
    # The IP literal, not `localhost` (RFC 8252 §7.3): localhost can resolve
    # to ::1 first while this listener is IPv4-only — browsers fall back, but
    # a proxy/resolver that doesn't would hang the sign-in. Entra ignores the
    # PORT on loopback redirects; the host must be registered (it is, next to
    # http://localhost).
    redirect_uri = f"http://127.0.0.1:{port}"

    url = AUTHORIZE_URL + "?" + urlencode({
        "client_id": CLIENT_ID,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "scope": SCOPES,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": state,
        # Always show the account picker: operator machines routinely hold a
        # personal Microsoft login, and silently reusing it connects the wrong
        # mailbox with no visible moment to catch it.
        "prompt": "select_account",
    })

    print()
    print("  Opening your browser to sign in to Microsoft...")
    print(f"  Sign in as {os.environ.get('EMAIL_ADDRESS', 'your outreach mailbox')} and approve the request.")
    print()
    print("  If the browser didn't open, paste this into it yourself:")
    print(f"    {url}")
    print()
    print("  If Microsoft says an admin's approval is needed: open the link below,")
    print("  sign in as the same mailbox, and press Accept. Approval is saved even")
    print("  if the page after it looks odd - then just run this sign-in again.")
    print(f"    {ADMIN_CONSENT_URL}")
    print()
    print("  Waiting for the browser sign-in (Ctrl+C to abort)...")

    if _graphical_browser_available():
        try:
            opened = webbrowser.open(url)
        except Exception:
            opened = False
    else:
        opened = False  # headless: don't launch a blocking text browser

    deadline = time.time() + _LOOPBACK_TIMEOUT
    try:
        while server.auth_result is None and time.time() < deadline:
            server.handle_request()
    finally:
        server.server_close()

    result = server.auth_result
    if result is None:
        if not opened:
            raise _LoopbackUnavailable("no browser could be opened on this machine")
        raise _LoopbackUnavailable("browser sign-in wasn't completed in time")

    if "error" in result:
        err = result.get("error", "")
        desc = result.get("error_description", "")[:300]
        if err == "access_denied":
            # The human pressed Cancel / No — respect it, don't fall back into
            # a second sign-in method they'd have to decline again.
            raise MsAuthError("Sign-in was declined in the browser.")
        raise MsAuthError(f"Sign-in failed: {err}: {desc}")

    tok_resp = _post(TOKEN_URL, {
        "client_id": CLIENT_ID,
        "grant_type": "authorization_code",
        "code": result["code"],
        "redirect_uri": redirect_uri,
        "code_verifier": verifier,
    })
    tok = tok_resp.json()
    if tok_resp.status_code != 200:
        err = tok.get("error", "")
        raise MsAuthError(
            f"Microsoft rejected the sign-in code exchange ({err}): "
            f"{tok.get('error_description', '')[:300]}"
        )

    cache = _store_token_response(tok)
    cache["account"] = _fetch_account(cache["access_token"])
    _save_cache(cache)
    if not quiet:
        acct = cache["account"] or {}
        print(f"\n  ✓ Signed in as {acct.get('address') or 'unknown account'}.")
        _warn_on_address_mismatch(acct)
    return cache


def login(quiet=False, force_device_code=False):
    """The one entry point callers should use: browser flow first, code-based
    flow only when the browser genuinely can't complete here (or on request).
    """
    if force_device_code:
        return device_code_login(quiet=quiet)
    try:
        return interactive_login(quiet=quiet)
    except _LoopbackUnavailable as why:
        print(f"\n  Couldn't finish the browser sign-in here ({why}).")
        print("  (If a Microsoft sign-in tab is still open from before, it's now stale —")
        print("  close it; finishing it will show a connection error, which is harmless.)")
        print("  Switching to code-based sign-in instead.")
        print("  (Heads up: some Microsoft business accounts block this method —")
        print("  if it tells you your sign-in 'does not meet the criteria', re-run")
        print("  login on a machine with a browser.)")
        return device_code_login(quiet=quiet)


# Where an organisation admin approves Klaudius for their whole tenant. Shown
# UP FRONT in the login instructions because the terminal cannot detect this
# failure itself: in device-code flow, a consent refusal happens entirely in
# the BROWSER — the poll below only ever sees authorization_pending until the
# code dies. The first buyer to hit the wall ("your sign-in was successful but
# you don't have permission to access this resource") lost a day and two
# support emails to it; the fix was this one URL, which the tool knew all
# along. The redirect lands on a klaudius.dev page that says "approved, go
# back to your terminal" — without it, Microsoft dumps the admin on
# http://localhost and a scary connection error AFTER the approval has
# already succeeded.
# v2.0 endpoint with EXPLICIT scopes: the v1 form consents to whatever the
# app registration's static permission list happens to hold — a drift hazard
# where an admin presses Accept, lands on the success page, and the runtime
# scopes still aren't granted. `organizations` rather than `common` per
# Microsoft's own doc ("Do not use 'common'... personal accounts cannot
# provide admin consent").
ADMIN_CONSENT_URL = (
    "https://login.microsoftonline.com/organizations/v2.0/adminconsent"
    f"?client_id={CLIENT_ID}"
    "&scope=https%3A%2F%2Fgraph.microsoft.com%2FMail.ReadWrite"
    "%20https%3A%2F%2Fgraph.microsoft.com%2FMail.Send"
    "%20https%3A%2F%2Fgraph.microsoft.com%2FUser.Read"
    "&redirect_uri=https%3A%2F%2Fklaudius.dev%2Fms-connected"
    "&state=klaudius"
)

# How many fresh sign-in codes to issue before giving up (each lives ~15 min).
# One code is NOT enough in the real world: the first buyer through this flow
# spent ~an hour untangling a consent question in the browser, came back to an
# expired code, and read the resulting error as total failure. Reissuing keeps
# the door open; the cap keeps a walked-away-from init from polling forever.
_MAX_DEVICE_CODES = 3


def _request_device_code():
    resp = _post(DEVICE_CODE_URL, {"client_id": CLIENT_ID, "scope": SCOPES})
    if resp.status_code != 200:
        raise MsAuthError(f"Microsoft device-code request failed ({resp.status_code}): {resp.text[:300]}")
    return resp.json()


def device_code_login(quiet=False):
    """Interactive one-time sign-in. Blocks until the user completes the
    browser step. Codes last ~15 min; expired ones are replaced automatically
    (up to _MAX_DEVICE_CODES) rather than failing the whole login — slow is
    normal for someone navigating a Microsoft consent screen for the first
    time. Returns the cache dict."""
    for code_round in range(_MAX_DEVICE_CODES):
        dc = _request_device_code()

        if code_round == 0:
            print()
            print("  To connect your Outlook / Microsoft 365 mailbox:")
            print(f"  1. Open   {dc['verification_uri']}")
            print(f"  2. Enter  {dc['user_code']}")
            print(f"  3. Sign in as {os.environ.get('EMAIL_ADDRESS', 'your outreach mailbox')} and approve the request.")
            print()
            print("  If Microsoft says you don't have permission, or that an admin's approval")
            print("  is needed: open the link below, sign in as the same mailbox, and press")
            print("  Accept — then come back here and enter the code again.")
            print(f"    {ADMIN_CONSENT_URL}")
            print()
            print("  Waiting for you to finish in the browser (Ctrl+C to abort)...")
        else:
            print()
            print("  That code expired while you were in the browser — no harm done.")
            print("  Here's a fresh one (anything you already approved still counts):")
            print(f"  1. Open   {dc['verification_uri']}")
            print(f"  2. Enter  {dc['user_code']}")
            print()
            print("  Waiting for you to finish in the browser (Ctrl+C to abort)...")

        interval = int(dc.get("interval", 5))
        deadline = time.time() + int(dc.get("expires_in", 900))
        while time.time() < deadline:
            time.sleep(interval)
            tok_resp = _post(TOKEN_URL, {
                "client_id": CLIENT_ID,
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                "device_code": dc["device_code"],
            })
            tok = tok_resp.json()
            if tok_resp.status_code == 200:
                cache = _store_token_response(tok)
                cache["account"] = _fetch_account(cache["access_token"])
                _save_cache(cache)
                if not quiet:
                    acct = cache["account"] or {}
                    print(f"\n  ✓ Signed in as {acct.get('address') or 'unknown account'}.")
                    _warn_on_address_mismatch(acct)
                return cache
            err = tok.get("error", "")
            if err == "authorization_pending":
                continue
            if err == "slow_down":
                interval += 5
                continue
            if err == "authorization_declined":
                raise MsAuthError("Sign-in was declined in the browser.")
            if err == "expired_token":
                break  # fall through to issue a replacement code
            raise MsAuthError(f"Sign-in failed: {err}: {tok.get('error_description', '')[:300]}")
        # deadline passed or Microsoft reported the code expired → next round

    raise MsAuthError(
        f"The sign-in wasn't completed after {_MAX_DEVICE_CODES} codes (~45 minutes). "
        "Run login again whenever you're ready."
    )


def _fetch_account(access_token):
    """Ask Graph who actually signed in, so we can catch wrong-mailbox sign-ins.

    Tries /me (needs the User.Read scope) and falls back to the OIDC userinfo
    endpoint (needs only openid/profile/email). The fallback matters for real
    tenants: when an app's recorded consent predates a scope, Microsoft
    silently omits that scope from the grant rather than failing — so /me can
    403 on a token that is otherwise perfectly healthy.
    """
    headers = {"Authorization": f"Bearer {access_token}"}
    try:
        r = requests.get(f"{GRAPH_BASE}/me", headers=headers, timeout=30)
        if r.status_code == 200:
            me = r.json()
            return {
                "address": (me.get("mail") or me.get("userPrincipalName") or "").strip(),
                "name": me.get("displayName") or "",
                "id": me.get("id") or "",
            }
        r = requests.get(
            "https://graph.microsoft.com/oidc/userinfo", headers=headers, timeout=30
        )
        if r.status_code == 200:
            info = r.json()
            return {
                "address": (info.get("email") or "").strip(),
                "name": info.get("name") or "",
                "id": info.get("sub") or "",
            }
    except requests.RequestException:
        pass
    return None


def _warn_on_address_mismatch(account):
    configured = os.environ.get("EMAIL_ADDRESS", "").strip().lower()
    actual = (account or {}).get("address", "").strip().lower()
    if configured and actual and configured != actual:
        print(
            f"\n  ⚠ .env says EMAIL_ADDRESS={configured} but you signed in as {actual}.\n"
            f"    Outreach will send from {actual}. If that's wrong, run "
            f"`python3 scripts/ms_oauth.py login` again with the right account;\n"
            f"    if it's right, update EMAIL_ADDRESS in .env to match.",
            file=sys.stderr,
        )


def _refresh(cache, _retry_after_race=True):
    resp = _post(TOKEN_URL, {
        "client_id": CLIENT_ID,
        "grant_type": "refresh_token",
        "refresh_token": cache["refresh_token"],
        "scope": SCOPES,
    })
    tok = resp.json()
    if resp.status_code != 200:
        err = tok.get("error", "")
        desc = tok.get("error_description", "")[:200]
        if err in ("invalid_grant", "interaction_required"):
            # Before declaring the sign-in dead, check whether a SIBLING
            # process already refreshed it. Microsoft rotates refresh tokens,
            # so when several parallel pipeline sessions hit an expired
            # access token at the same moment, the first one to refresh can
            # invalidate the token the others are still holding. Losing that
            # race is not an expired sign-in — telling the operator to
            # re-authenticate would be plain wrong, and they'd do it.
            fresh = _load_cache() or {}
            if (
                _retry_after_race
                and fresh.get("refresh_token")
                and fresh["refresh_token"] != cache.get("refresh_token")
            ):
                if fresh.get("access_token") and time.time() < fresh.get("expires_at", 0) - _REFRESH_SKEW:
                    return fresh
                # One retry only — if the sibling's token is dead too, this is
                # a real expiry, not a race.
                return _refresh(fresh, _retry_after_race=False)
            # Genuinely dead (password changed, sessions revoked, 90-day
            # inactivity). Only a human sign-in fixes this.
            raise MsAuthError(
                "Your Microsoft sign-in has expired and needs redoing: run "
                f"`python3 scripts/ms_oauth.py login` ({err}: {desc})"
            )
        raise MsAuthError(f"Microsoft token refresh failed ({err or resp.status_code}): {desc}")
    return _store_token_response(tok, prior=cache)


def get_access_token():
    """Return a currently-valid access token, refreshing if needed.

    Raises MsAuthError with an operator-actionable message when there is no
    cached sign-in or the refresh token is dead — callers should surface the
    message verbatim rather than retrying.
    """
    cache = _load_cache()
    if not cache or not cache.get("refresh_token"):
        raise MsAuthError(
            "No Microsoft sign-in found. Run `python3 scripts/ms_oauth.py login` "
            "to connect your Outlook / Microsoft 365 mailbox (one-time)."
        )
    if cache.get("access_token") and time.time() < cache.get("expires_at", 0) - _REFRESH_SKEW:
        return cache["access_token"]
    return _refresh(cache)["access_token"]


def get_account():
    """The signed-in account dict ({address, name, id}) or None."""
    cache = _load_cache()
    return (cache or {}).get("account")


def graph_request(method, path, *, params=None, headers=None, data=None, json_body=None,
                  timeout=60, retries=2):
    """Authenticated Graph call with 401-retry (stale token) and 429/503 backoff.

    `path` is relative to https://graph.microsoft.com/v1.0 (or absolute).
    Returns the requests.Response. Raises MsAuthError on auth failure and
    RuntimeError on a non-2xx response after retries — messages are
    operator-facing, so callers can surface them directly.
    """
    url = path if path.startswith("http") else f"{GRAPH_BASE}{path}"
    attempt = 0
    forced_refresh = False
    while True:
        token = get_access_token()
        h = {"Authorization": f"Bearer {token}"}
        if headers:
            h.update(headers)
        try:
            resp = requests.request(
                method, url, params=params, headers=h, data=data, json=json_body, timeout=timeout
            )
        except requests.RequestException as e:
            raise RuntimeError(
                "Couldn't reach Microsoft (network error). Check your internet "
                f"connection, then try again. [{type(e).__name__}]"
            ) from e
        if resp.status_code == 401 and not forced_refresh:
            # Access token rejected despite looking fresh (revocation, clock
            # skew). Force one refresh-token round trip, then give up to the
            # operator-facing error below.
            forced_refresh = True
            cache = _load_cache()
            if cache and cache.get("refresh_token"):
                _refresh(cache)
                continue
        if resp.status_code in (429, 503) and attempt < retries:
            attempt += 1
            # Retry-After is seconds OR an HTTP-date; int() on the latter
            # would raise and turn a survivable throttle into a hard failure.
            raw_wait = (resp.headers.get("Retry-After") or "5").strip()
            wait = int(raw_wait) if raw_wait.isdigit() else 5
            time.sleep(min(wait, 60))
            continue
        if resp.status_code >= 400:
            try:
                err = resp.json().get("error", {})
                detail = f"{err.get('code', '')}: {err.get('message', '')[:300]}"
            except ValueError:
                detail = resp.text[:300]
            if resp.status_code == 401:
                raise MsAuthError(
                    "Microsoft rejected the sign-in (401) even after refreshing. Run "
                    f"`python3 scripts/ms_oauth.py login` to reconnect. ({detail})"
                )
            raise RuntimeError(f"Microsoft Graph {method} {path} failed ({resp.status_code}) — {detail}")
        return resp


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Microsoft OAuth sign-in for Klaudius email")
    sub = parser.add_subparsers(dest="command", required=True)
    login_parser = sub.add_parser("login", help="One-time sign-in (browser opens; falls back to a code)")
    login_parser.add_argument(
        "--device-code", action="store_true",
        help="Skip the browser flow and use the enter-a-code flow directly "
             "(for SSH/remote machines; some business tenants block this method)")
    sub.add_parser("status", help="Check whether a working sign-in is present")
    sub.add_parser("logout", help="Delete the local token cache")
    args = parser.parse_args()

    if args.command == "login":
        try:
            login(force_device_code=args.device_code)
        except MsAuthError as e:
            print(f"\nERROR: {e}", file=sys.stderr)
            sys.exit(1)
        except KeyboardInterrupt:
            print("\nAborted.", file=sys.stderr)
            sys.exit(130)

    elif args.command == "status":
        try:
            get_access_token()
            acct = get_account() or {}
            print(f"OK: signed in as {acct.get('address') or 'unknown account'} "
                  f"(token cache: {TOKEN_PATH})")
            _warn_on_address_mismatch(acct)
        except MsAuthError as e:
            print(f"NOT CONNECTED: {e}", file=sys.stderr)
            sys.exit(1)

    elif args.command == "logout":
        try:
            os.remove(TOKEN_PATH)
            print(f"Removed {TOKEN_PATH}")
        except FileNotFoundError:
            print("No token cache to remove.")


if __name__ == "__main__":
    main()
