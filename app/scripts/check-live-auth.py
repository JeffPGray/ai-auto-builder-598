#!/usr/bin/env python3
"""
check-live-auth.py - Live email authentication test (the authoritative one).

Sends ONE small plain-text message from your configured mail account, then
reads it back over IMAP and reports the SPF / DKIM / DMARC verdicts the
RECEIVING server stamped on it.

Deliberately does NOT report inbox-vs-spam placement as a result. A provider
effectively never spam-folders mail you send to yourself, so "landed in the
inbox" would be a green tick that means nothing — and a meaningless green
tick is worse than no signal, because it invites you to treat it as proof.
Placement is reported only when a SELF-ADDRESSED message lands in spam,
which is genuinely alarming.

Why this exists rather than just checking DNS:
  DNS can prove SPF and DMARC exist, but it CANNOT prove whether DKIM is
  signing. A DKIM key lives at <selector>._domainkey.<domain>, and the
  selector is chosen by your provider — it is not discoverable. Sweeping
  common selectors gives false negatives on perfectly healthy domains
  (IONOS signs with `s1-ionos`, delegated by CNAME; no generic sweep finds
  it). Reading the verdict off a real delivered message is the only method
  that cannot be fooled, and it reveals the selector as a side effect.

Usage:
  python3 scripts/check-live-auth.py                     # send to yourself
  python3 scripts/check-live-auth.py --to you@gmail.com  # send to another
                                                         # mailbox you own
  python3 scripts/check-live-auth.py --json

Sending to yourself needs no extra setup and works on every provider tested.
Sending to a mailbox on a DIFFERENT provider is a stronger test (it exercises
the real external path and gives a meaningful inbox-vs-spam signal), but this
script can only read back a mailbox it has IMAP credentials for — so with
--to you must check the result by hand unless it is the configured account.

Config comes from .env, same keys scripts/gmail.py uses.
"""

import argparse
import email
import imaplib
import json
import os
import re
import smtplib
import sys
import time
import uuid
from email.mime.text import MIMEText
from email.utils import formatdate, make_msgid
from pathlib import Path

# Trust the OS root-CA store before TLS negotiation — same reason as gmail.py
# (corporate proxies / antivirus that MITM TLS break IMAP and SMTP otherwise).
try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass


def load_env():
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                value = value.strip()
                # Strip matching surrounding quotes, as dotenv does. A
                # hand-edited .env with EMAIL_PASSWORD="app pass here" would
                # otherwise send the literal quote characters as part of the
                # password, and the server's rejection reads as a wrong
                # password rather than a quoting problem. Matches the same
                # handling in scripts/check-dns-auth.js.
                if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                    value = value[1:-1]
                os.environ.setdefault(key.strip(), value)


load_env()

# Degrade unencodable glyphs (✓ ✗ ⚠) instead of crashing on Windows pipes —
# same guard as ms_oauth.py; the deliverability skill captures this output.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(errors="replace")
    except Exception:
        pass

# Make sibling scripts importable regardless of how this file is invoked —
# ms_oauth is imported lazily from three different functions below, so
# relying on any one of them running first would be fragile.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

POLL_ATTEMPTS = 20
POLL_INTERVAL = 6  # seconds → ~2 minutes total

# Outlook / Microsoft 365 mode: no SMTP/IMAP exists for these mailboxes any
# more (Microsoft retired app-password access), so the probe is sent and read
# back through the Microsoft Graph API instead. Same message, same
# Authentication-Results parsing — only the transport differs.
USE_GRAPH = os.environ.get("EMAIL_AUTH", "").strip().lower() == "oauth-microsoft"


def get_config():
    address = os.environ.get("EMAIL_ADDRESS", "").strip()
    if USE_GRAPH:
        from ms_oauth import get_account
        address = ((get_account() or {}).get("address") or address).strip()
        if not address:
            print("ERROR: EMAIL_AUTH=oauth-microsoft but there is no Microsoft sign-in. "
                  "Run `python3 scripts/ms_oauth.py login` first.", file=sys.stderr)
            sys.exit(1)
        return {
            "address": address,
            "from_name": os.environ.get("EMAIL_FROM_NAME", "").strip() or address,
            "domain": address.split("@", 1)[1] if "@" in address else "localhost",
        }
    password = os.environ.get("EMAIL_PASSWORD", "").strip()
    smtp_host = os.environ.get("EMAIL_SMTP_HOST", "").strip()
    imap_host = os.environ.get("EMAIL_IMAP_HOST", "").strip()
    if not (address and password and smtp_host and imap_host):
        print("ERROR: EMAIL_ADDRESS, EMAIL_PASSWORD, EMAIL_SMTP_HOST and EMAIL_IMAP_HOST "
              "must all be set in .env", file=sys.stderr)
        sys.exit(1)

    inbox = os.environ.get("EMAIL_INBOX_FOLDER", "INBOX").strip()
    # Folder names containing spaces must be quoted for IMAP SELECT, or the
    # server rejects the command ("Sent Items" is the classic offender).
    if " " in inbox and not inbox.startswith('"'):
        inbox = f'"{inbox}"'

    return {
        "address": address,
        "password": password,
        "smtp_host": smtp_host,
        "smtp_port": int(os.environ.get("EMAIL_SMTP_PORT", "587")),
        "imap_host": imap_host,
        "imap_port": int(os.environ.get("EMAIL_IMAP_PORT", "993")),
        "from_name": os.environ.get("EMAIL_FROM_NAME", "").strip() or address,
        "inbox": inbox,
        "domain": address.split("@", 1)[1] if "@" in address else "localhost",
    }


def send_probe(cfg, to_addr, nonce):
    subject = f"Klaudius deliverability self-test {nonce}"
    msg = MIMEText(
        "This is an automated authentication test sent by the Klaudius "
        "deliverability check.\n\n"
        f"Reference: {nonce}\n\n"
        "It confirms your SPF, DKIM and DMARC are working on real delivered "
        "mail. Nothing was sent to anyone else. Safe to delete.\n",
        "plain",
    )
    msg["From"] = f"{cfg['from_name']} <{cfg['address']}>"
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=cfg["domain"])

    if USE_GRAPH:
        import base64
        from ms_oauth import graph_request
        graph_request(
            "POST", "/me/sendMail",
            headers={"Content-Type": "text/plain"},
            data=base64.b64encode(msg.as_bytes()),
        )
        return subject

    if cfg["smtp_port"] == 465:
        server = smtplib.SMTP_SSL(cfg["smtp_host"], cfg["smtp_port"], timeout=30)
    else:
        server = smtplib.SMTP(cfg["smtp_host"], cfg["smtp_port"], timeout=30)
        server.starttls()
    server.login(cfg["address"], cfg["password"])
    server.sendmail(cfg["address"], [to_addr], msg.as_string())
    server.quit()
    return subject


# Spam folders differ per provider; try each and report which one matched.
# Name fragments that identify a junk folder when the server doesn't advertise
# the RFC 6154 \Junk attribute. Matched case-insensitively against the real
# folder list, so INBOX.Junk (the Dovecot/cPanel/IONOS convention) and
# [Gmail]/Spam are both picked up without hardcoding either.
SPAM_NAME_HINTS = ("spam", "junk", "bulk")


def discover_spam_folders(imap):
    """Return the mailbox's actual junk folders.

    Enumerating once beats probing a list of guesses: on a server with five
    mailboxes, SELECTing eleven candidate names every poll cycle costs
    hundreds of round trips and can outlast the polling window entirely.
    Prefers the \\Junk SPECIAL-USE flag, falls back to name matching.
    """
    found = []
    try:
        typ, data = imap.list()
    except Exception:
        return found
    if typ != "OK" or not data:
        return found

    for row in data:
        if not row:
            continue
        # A row is normally one bytestring, but a name sent as an IMAP literal
        # arrives as a (header, name) tuple.
        if isinstance(row, tuple):
            parts = [p.decode("utf-8", errors="replace") if isinstance(p, bytes) else str(p) for p in row]
            line, literal_name = " ".join(parts[:-1]), parts[-1]
        else:
            line = row.decode("utf-8", errors="replace") if isinstance(row, bytes) else str(row)
            literal_name = None

        # `(\HasNoChildren \Junk) "/" "INBOX.Junk"` — attributes, delimiter, name.
        attrs = line[1:line.index(")")].lower() if "(" in line and ")" in line else ""

        # Take the trailing QUOTED name when there is one. Splitting on the last
        # space instead turns "Junk E-mail" into "E-mail" and "INBOX.Junk Mail"
        # into "Mail" — so Outlook and cPanel junk folders were never found, and
        # the SELECT on the truncated name failed silently.
        if literal_name is not None:
            name = literal_name
        else:
            quoted = re.search(r'"([^"]*)"\s*$', line)
            name = quoted.group(1) if quoted else line.rsplit(" ", 1)[-1].strip()
        name = name.strip()
        if not name:
            continue
        if "\\junk" in attrs or any(h in name.lower() for h in SPAM_NAME_HINTS):
            found.append(f'"{name}"' if " " in name else name)
    return found


def find_message_graph(nonce):
    """Graph twin of find_message: poll Inbox + Junk Email for the probe,
    fetch its raw MIME, and hand back the same (message, folder_kind) shape so
    parse_auth and all reporting below stay backend-agnostic."""
    from ms_oauth import MsAuthError, graph_request
    for _ in range(POLL_ATTEMPTS):
        for folder, kind in (("inbox", "inbox"), ("junkemail", "spam")):
            try:
                resp = graph_request(
                    "GET", f"/me/mailFolders/{folder}/messages",
                    params={"$search": f'"{nonce}"', "$select": "id,subject", "$top": "10"},
                )
                hits = [m for m in resp.json().get("value", [])
                        if nonce in (m.get("subject") or "")]
                if hits:
                    raw = graph_request("GET", f"/me/messages/{hits[-1]['id']}/$value").content
                    return email.message_from_bytes(raw), kind
            except MsAuthError:
                raise  # not signed in — say so now, don't poll for 2 minutes
            except Exception:
                continue
        time.sleep(POLL_INTERVAL)
    return None, None


def find_message(cfg, nonce):
    """Poll for the probe. Returns (headers, folder_kind) or (None, None)."""
    if USE_GRAPH:
        return find_message_graph(nonce)
    # timeout= matters here specifically: this runs AFTER the mail has been
    # sent, so a host that accepts TCP but never speaks would hang the process
    # indefinitely with the message already gone.
    try:
        imap = imaplib.IMAP4_SSL(cfg["imap_host"], cfg["imap_port"], timeout=30)
        imap.login(cfg["address"], cfg["password"])
    except Exception as e:
        print(f"\n✗ Sent, but could not open your inbox to read it back: {e}\n"
              f"  The message did go out — only the verification half failed. Check "
              f"EMAIL_IMAP_HOST/PORT and your app password (`npx klaudius@latest doctor`).\n",
              file=sys.stderr)
        raise SystemExit(2)
    spam_folders = discover_spam_folders(imap)
    try:
        for _ in range(POLL_ATTEMPTS):
            for folder, kind in [(cfg["inbox"], "inbox")] + [(f, "spam") for f in spam_folders]:
                try:
                    typ, _ = imap.select(folder, readonly=True)
                except Exception:
                    continue
                if typ != "OK":
                    continue
                typ, data = imap.search(None, f'(HEADER SUBJECT "{nonce}")')
                if typ != "OK" or not data or not data[0].split():
                    continue
                mid = data[0].split()[-1]
                typ, fetched = imap.fetch(mid, "(BODY.PEEK[HEADER])")
                if typ == "OK" and fetched and isinstance(fetched[0], tuple):
                    return email.message_from_bytes(fetched[0][1]), kind
            time.sleep(POLL_INTERVAL)
        return None, None
    finally:
        try:
            imap.logout()
        except Exception:
            pass


def parse_auth(msg, sending_domain):
    """Pull spf/dkim/dmarc verdicts + DKIM selector out of the header the
    receiving server stamped.

    Two things this has to get right, both of which produce a confidently
    WRONG verdict if fudged:

    1. Use only the FIRST Authentication-Results header. Mail can carry
       several (one per hop); only the topmost was added by the server that
       actually accepted the message, and the rest are untrusted. Joining
       them lets an older hop's value fill in for a mechanism the trusted
       header omitted.

    2. Pick the dkim= result belonging to OUR domain. Multi-signature mail is
       routine (an ESP or mailing list signs alongside the sender), so the
       first dkim= in the header is frequently a third party's — and reporting
       their `dkim=fail` as the operator's would send them off to "fix" a key
       that is signing perfectly.
    """
    headers = msg.get_all("Authentication-Results") or []
    if not headers:
        headers = msg.get_all("ARC-Authentication-Results") or []
    raw = re.sub(r"\s+", " ", headers[0]).strip() if headers else ""

    # Split into per-method chunks so each verdict keeps its own properties.
    # `(?:^|[;\s])` rather than `\b`: "-" is a non-word char, so `\bdkim=`
    # also matches inside `x-dkim=` / `arc-dkim=`.
    # Matches header.i= / header.d= belonging to `sending_domain`, in every form
    # a real header uses:
    #   header.i=rohan@example.com   (local part present — the IONOS form)
    #   header.i=@example.com
    #   header.d=example.com
    #   header.d=mail.example.com    (subdomain of ours, still ours)
    # and NOT notexample.com (needs a label boundary before) or example.com.au
    # (needs one after). An earlier version used `@?[\w.-]*` here, which failed
    # on the local-part form — `@` isn't in the class — so the filter silently
    # matched nothing and fell back to the FIRST signature, i.e. the third
    # party's. That is the exact bug this filter exists to prevent.
    dom_re = None
    if sending_domain:
        dom_re = re.compile(
            rf"header\.(?:i|d)=(?:[^;\s@]*@)?(?:[\w-]+\.)*{re.escape(sending_domain)}(?![\w.-])",
            re.I,
        )

    verdicts = {}
    dkim_tail = None
    for mech in ("spf", "dkim", "dmarc"):
        # Bound each result's property window at the next ";" — results in an
        # Authentication-Results header are ";"-delimited, and a fixed-width
        # window runs into the NEXT signature's properties, which makes a third
        # party's dkim=fail look like it belongs to our domain.
        matches = [
            (m.group(1).lower(), raw[m.end():].split(";", 1)[0])
            for m in re.finditer(rf"(?:^|[;\s]){mech}=(\w+)", raw)
        ]
        if not matches:
            verdicts[mech] = None
            continue
        if mech == "dkim" and len(matches) > 1 and dom_re:
            mine = [(v, tail) for v, tail in matches if dom_re.search(tail)]
            if mine:
                matches = mine
        verdicts[mech] = matches[0][0]
        if mech == "dkim":
            dkim_tail = matches[0][1]

    # Read the selector out of the SAME chunk as the dkim verdict we chose, so
    # the two can never describe different signatures — reporting a third
    # party's selector would send the operator to `--selector <theirs>`, which
    # then fails against their own healthy domain.
    sel = None
    if dkim_tail:
        m = re.search(r"header\.s=([^;\s]+)", dkim_tail)
        sel = m.group(1) if m else None
    # Sending servers sometimes leave their own DKIM-Signature on the copy;
    # the Authentication-Results selector is authoritative, this is a fallback.
    if not sel and msg.get("DKIM-Signature"):
        m = re.search(r"[;\s]s=([^;\s]+)", re.sub(r"\s+", " ", msg["DKIM-Signature"]))
        sel = m.group(1) if m else None

    return {"raw": raw, "verdicts": verdicts, "selector": sel, "stamped": bool(raw)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--to", help="Send to another mailbox you own (checked by hand unless it is your configured account)")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    cfg = get_config()
    to_addr = (args.to or cfg["address"]).strip()
    external = to_addr.lower() != cfg["address"].lower()
    nonce = uuid.uuid4().hex[:12]

    if not args.json:
        print(f"\nSending one test message: {cfg['address']} → {to_addr}")

    try:
        send_probe(cfg, to_addr, nonce)
    except Exception as e:
        result = {"ok": False, "stage": "send", "error": str(e)}
        hint = ("Your Microsoft sign-in is the place to look "
                "(`python3 scripts/ms_oauth.py status`, then `login` if needed)."
                if USE_GRAPH else
                "Your SMTP settings or app password are the place to look "
                "(`npx klaudius@latest doctor` checks them).")
        print(json.dumps(result, indent=2) if args.json
              else f"\n✗ Could not send: {e}\n  {hint}\n")
        sys.exit(1)

    if external:
        out = {"ok": True, "sent": True, "to": to_addr, "reference": nonce, "read_back": False,
               "note": "Sent to a mailbox this script has no credentials for. Open it and check the "
                       "message's 'show original' / 'view source' for the Authentication-Results header."}
        print(json.dumps(out, indent=2) if args.json
              else f"\n✓ Sent (reference {nonce}).\n\n  It went to a mailbox I cannot read, so check it by hand:\n"
                   f"  open the message → 'Show original' (Gmail) or 'View source' → look for\n"
                   f"  Authentication-Results, and confirm spf=pass dkim=pass dmarc=pass.\n")
        return

    if not args.json:
        print(f"Sent. Waiting for it to arrive (up to {POLL_ATTEMPTS * POLL_INTERVAL // 60} min)…")

    msg, folder_kind = find_message(cfg, nonce)

    if msg is None:
        out = {"ok": False, "stage": "receive", "verdict": "inconclusive", "reference": nonce,
               "note": "Message not observed. It may simply be slow, or your provider may not deliver "
                       "self-addressed mail through its normal inbound path."}
        print(json.dumps(out, indent=2) if args.json
              else f"\n? Inconclusive — the message did not arrive within the polling window.\n\n"
                   f"  Not necessarily a problem. Re-run with --to <any other email address you can\n"
                   f"  open> — that exercises the real delivery path and gives a clearer answer.\n")
        sys.exit(2)

    auth = parse_auth(msg, cfg["domain"])

    if not auth["stamped"]:
        out = {"ok": False, "verdict": "inconclusive", "reference": nonce, "folder": folder_kind,
               "note": "Delivered, but the receiving server stamped no Authentication-Results header — "
                       "some providers skip it on mail from themselves. This is not a failure."}
        print(json.dumps(out, indent=2) if args.json
              else "\n? Inconclusive — it arrived, but your provider stamped no Authentication-Results\n"
                   "  header on it. Google does this: it skips authentication checks entirely on mail\n"
                   "  you send to yourself. That is a property of your provider, NOT a sign that\n"
                   "  anything is wrong with your setup.\n\n"
                   "  Re-run with --to <any other email address you can open> to get a real verdict.\n")
        sys.exit(2)

    v = auth["verdicts"]
    # temperror/permerror are the RECEIVER's transient or config-side lookup
    # failures, and Yahoo's "bestguesspass" is a heuristic pass for domains
    # with no SPF. None of those are the operator's configuration failing, so
    # they must not be reported as "fix your DNS".
    INCONCLUSIVE = ("temperror", "permerror", "bestguesspass", "policy", "unknown")
    passed = [k for k, val in v.items() if val == "pass"]
    failed = [k for k, val in v.items() if val is not None and val != "pass" and val not in INCONCLUSIVE]
    unclear = [k for k, val in v.items() if val in INCONCLUSIVE]
    absent = [k for k, val in v.items() if val is None]
    ok = not failed and len(passed) >= 2

    # "problem" must mean something is actually wrong. When nothing failed but
    # verdicts are missing or inconclusive, that is `inconclusive` — the skill
    # tells the agent inconclusive is not a failure, and the JSON has to agree
    # with the human text or an agent reading --json relays a false alarm.
    verdict = "pass" if ok else ("problem" if failed else "inconclusive")
    out = {
        "ok": ok, "verdict": verdict, "reference": nonce,
        "folder": folder_kind, "spf": v["spf"], "dkim": v["dkim"], "dmarc": v["dmarc"],
        "dkim_selector": auth["selector"], "authentication_results": auth["raw"][:500],
    }

    # Exit code must mean the same thing in both modes. Returning here used to
    # exit 0 on a "problem" verdict, while identical state exited 1 in text
    # mode — and the skill points the agent at --json for reasoning.
    # 0 = pass, 1 = a mechanism actually failed, 2 = inconclusive.
    exit_code = 0 if ok else (1 if failed else 2)

    if args.json:
        print(json.dumps(out, indent=2))
        sys.exit(exit_code)

    def icon(s):
        if s == "pass":
            return "✓"
        if s is None:
            return "·"
        return "?" if s in INCONCLUSIVE else "✗"
    print("\nVerdicts stamped by the receiving server:\n")
    for mech in ("spf", "dkim", "dmarc"):
        print(f"  {icon(v[mech])} {mech.upper():<6} {v[mech] or 'not reported'}")
    if auth["selector"]:
        print(f"\n  DKIM selector in use: {auth['selector']}")
        print(f"  Inspect the record:   node scripts/check-dns-auth.js --selector {auth['selector']}")
    # Only surface placement when it is bad. See the module docstring: an
    # inbox landing on self-addressed mail is not evidence of anything.
    if folder_kind == "spam":
        print("\n  ⚠ This message went to SPAM — and you sent it to yourself, which makes that\n"
              "    a serious signal. Check your domain against the major blocklists, and look\n"
              "    at whether your sending domain is newly registered or recently reported.")

    if failed:
        print(f"\n✗ Not passing: {', '.join(failed)}. Run `node scripts/check-dns-auth.js` — it prints the "
              f"exact DNS records to fix each one.\n")
    elif unclear:
        print(f"\n? {', '.join(unclear)} came back inconclusive ("
              f"{', '.join(sorted({v[k] for k in unclear}))}) — that is the receiving server's own lookup "
              f"failing or guessing, not your configuration. Nothing to fix; re-run later to get a clean read.\n")
    elif absent:
        print(f"\n! Passing what was checked, but {', '.join(absent)} was not reported. "
              f"Re-run with --to a mailbox on a different provider for a fuller picture.\n")
    else:
        print("\n✓ Your mail is authenticating correctly on real delivered messages.\n")

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
