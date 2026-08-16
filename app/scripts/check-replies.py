#!/usr/bin/env python3
"""check-replies.py — list every client whose thread needs eyes: cold-cadence
rows due a status change, and warm (responded) rows where the client spoke
last.

Pulls `status='outreach_sent'` clients with at least one inbound on record,
then filters out any that already carry a fresh classification we don't need
to re-act on. The remaining rows are what /follow-up Step 1 classifies and
auto-acts on:

  noise      -> classify_inbound('noise', ...) — keep cadence going
  genuine    -> set_response — promotes to 'responded' (warm-leads lane)
  rejection  -> set_rejected — closes the lead
  unclear    -> classify_inbound('unclear', ...) and surface for human

ALSO pulls `status='responded'` clients where the client spoke last
(has_inbound_since_last_out) — otherwise engaging moved a client out of the
only status scanned here, and their later (warmest) messages silently left
the routine reply loop; that hid a near-conversion reply for a week
(field report, 2026-07-27). Warm rows are unclassified by default
(set_response writes none), so their one test is "did the client speak
last" — but a fresh `noise` classification, when present, dismisses the
row: a warm row only hides when WE speak, and nobody replies to a bare
tapback, so without the dismissal it would surface forever (field report,
2026-08-08). The normal exit is a human reply; the noise dismissal is for
inbounds no human would answer.

Reads from the materialised cache populated by `sync_thread_state.py`.
This script does NOT re-walk threads. If the cache might be stale, run
the sync first:

  python3 scripts/sync_thread_state.py

Then:
  python3 scripts/check-replies.py                  # rows needing classification or review
  python3 scripts/check-replies.py --include-noise  # also show fresh-noise rows (audit)
  python3 scripts/check-replies.py --channel sms

A classification is *fresh* while `last_in_classified_for_date == last_in_date`.
A new inbound advances `last_in_date` and the row reappears here for
re-classification.
"""

import argparse
import os
import sys
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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from db import get_db


def fetch_pending(channel: Optional[str] = None, include_noise: bool = False) -> list[dict]:
    """Surface every cold-cadence client whose thread might warrant a status
    change. The skill's job is to classify each row and auto-act:
      - genuine engagement -> set_response (status moves to 'responded')
      - clear rejection    -> set_rejected (status moves to 'rejected')
      - auto-ack/OOO/tapback only -> classify_inbound('noise', ...)
      - ambiguous          -> classify_inbound('unclear', ...) and surface

    Once status moves out of 'outreach_sent', the row drops from this list
    automatically. We pull every outreach_sent client that has ever had an
    inbound -- not just where the latest message is inbound -- so that
    a manual operator reply burying the inbound doesn't hide the engagement.
    """
    rows = (
        get_db()
        .table("clients")
        .select(
            "slug,name,outreach_channel,status,last_out_date,last_in_date,"
            "last_in_preview,outgoing_touch_count,thread_synced_at,"
            "last_in_classification,last_in_classified_for_date,"
            "has_inbound_since_last_out"
        )
        .in_("status", ["outreach_sent", "responded"])
        .not_.is_("last_in_date", "null")
        .order("last_in_date", desc=True)
        .execute()
        .data
        or []
    )

    if channel and channel != "all":
        rows = [r for r in rows if r.get("outreach_channel") == channel]

    # Warm lane: the client spoke last. None/missing (never synced) counts
    # as False, not unknown-so-surface.
    warm = [r for r in rows if r.get("status") == "responded"
            and bool(r.get("has_inbound_since_last_out"))]
    cold = [r for r in rows if r.get("status") == "outreach_sent"]

    if not include_noise:
        # Fresh-noise rows hide in BOTH lanes (warm rationale: module
        # docstring). Cold `unclear` still surfaces (human review needed);
        # `genuine`/`rejection` never appear here — their status changes
        # move rows out of outreach_sent.
        warm = [r for r in warm if not _is_fresh_noise(r)]
        cold = [r for r in cold if _needs_attention(r)]

    # Warm first — a reply from someone already engaged outranks cold triage.
    return warm + cold


def _is_fresh_noise(row: dict) -> bool:
    if row.get("last_in_classification") != "noise":
        return False
    return row.get("last_in_classified_for_date") == row.get("last_in_date")


def _needs_attention(row: dict) -> bool:
    """Row needs the skill to classify or re-classify.

    Hides only fresh-noise rows. Unclassified, stale, and fresh-unclear all
    surface so the skill can read the thread and decide.
    """
    cls = row.get("last_in_classification")
    cls_for = row.get("last_in_classified_for_date")
    if cls is None:
        return True  # never classified
    if cls_for != row.get("last_in_date"):
        return True  # stale -- a new inbound has arrived since last classification
    if cls == "noise":
        return False  # auto-dismissed
    return True  # fresh-unclear (or any other classification we don't auto-act on)


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument(
        "--channel",
        choices=["sms", "email", "whatsapp", "all"],
        default="all",
        help="Restrict to a single channel (default: all).",
    )
    p.add_argument(
        "--include-noise",
        action="store_true",
        help="Show rows classified as fresh noise (default: hidden).",
    )
    args = p.parse_args()

    rows = fetch_pending(args.channel, include_noise=args.include_noise)
    if not rows:
        print("No pending inbounds need attention.")
        return

    warm_count = sum(1 for r in rows if r.get("status") == "responded"
                     and not _is_fresh_noise(r))
    cold = [r for r in rows if r.get("status") == "outreach_sent"]
    needs_classification = sum(1 for r in cold if r.get("last_in_classification") is None
                               or r.get("last_in_classified_for_date") != r.get("last_in_date"))
    print(f"=== {len(rows)} pending inbound(s) — {warm_count} warm repl(ies) awaiting "
          f"your answer, {needs_classification} cold unclassified ===\n")

    for r in rows:
        if r.get("status") == "responded":
            # A dismissed warm row is only reachable with --include-noise.
            cls_label = ("[warm — dismissed as noise]" if _is_fresh_noise(r)
                         else "[warm reply — client spoke last]")
        else:
            cls = r.get("last_in_classification")
            cls_for = r.get("last_in_classified_for_date")
            if cls is None:
                cls_label = "[unclassified]"
            elif cls_for != r.get("last_in_date"):
                cls_label = f"[stale: was {cls}, new inbound]"
            else:
                cls_label = f"[{cls}]"

        print(
            f"  {r['name']} ({r['slug']}) {cls_label} "
            f"[{r['outreach_channel']}, status={r['status']}]"
        )
        print(f"    last_in:  {r.get('last_in_date') or '?'}")
        print(f"    last_out: {r.get('last_out_date') or '?'}")
        print(f"    touches:  {r.get('outgoing_touch_count')}")
        preview = (r.get("last_in_preview") or "").strip()
        if preview:
            print(f"    preview:  {preview}")
        print()

    print(
        "Auto-actions the skill should take after reading each COLD "
        "(status=outreach_sent) thread:\n"
        "  noise (auto-ack / OOO / tapback only):\n"
        "    python3 -c \"from scripts.db import classify_inbound; classify_inbound('SLUG','noise','LAST_IN_DATE')\"\n"
        "  genuine engagement:\n"
        "    python3 -c \"from scripts.db import set_response; set_response('SLUG','one-line reason')\"\n"
        "  clear rejection:\n"
        "    python3 -c \"from scripts.db import set_rejected; set_rejected('SLUG','one-line reason')\"\n"
        "  ambiguous (defer to human):\n"
        "    python3 -c \"from scripts.db import classify_inbound; classify_inbound('SLUG','unclear','LAST_IN_DATE')\"\n"
        "\n"
        "WARM rows (status=responded): the operator owes the reply — surface\n"
        "  first, draft if asked, NEVER auto-send. Pure noise (bare tapback /\n"
        "  auto-ack / OOO) may be dismissed — it resurfaces on their next real\n"
        "  message:\n"
        "    python3 -c \"from scripts.db import classify_inbound; classify_inbound('SLUG','noise','LAST_IN_DATE')\""
    )


if __name__ == "__main__":
    main()
