#!/usr/bin/env python3
"""Contract test: WHEN the GHL demo-built tag is applied.

This guards a defect that costs real money and real reputation: a prospect
receiving TWO first-touch emails, one from the warmed mailbox and one from
GoHighLevel.

The live workflow "GR-598 Demo-First Send"
(be39fdee-05ef-4250-8277-79d7c527cd97, location fHLsjtxsf1nWzIfVvxY6) triggers
on `Tag added includes "demo-built"` and then runs
`T1 Demo Site Delivered D0 -> Wait -> T2 Nudge D3`. Read off the live builder
canvas on 2026-08-15 - the GHL v2 workflows API returns only
id/name/status/version and NO trigger data, so this cannot be re-derived from
code and must be re-checked in the UI if the workflow is edited.

Two consequences, and this file pins both:

  * the tag has to land at DEPLOY time, because the workflow itself sends the
    first email. Tag late and GHL's T1 arrives after the mailbox already sent.
  * the tag must NOT be re-applied at outreach-sent time.

The tag STRING is not ours to choose. It mirrors the workflow's trigger
exactly; changing one without the other silently detaches the pipeline from
the automation, and nothing errors - prospects just quietly stop being
enrolled. That is the failure this test is really here to catch.

Run: python3 tests/test_ghl_stage.py
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

# A syntactically valid but non-functional token: get_config() requires a key
# before it will build any payload, and this file must never touch the network.
os.environ["GHL_API_KEY"] = "pit-contract-test-not-a-real-token"
# Ensure an operator override in .env cannot mask a regression in the default.
os.environ.pop("GHL_DEMO_SENT_TAG", None)
# GHL must be the chosen sender for any enrolment to be correct. The
# mailbox/ghl split is asserted on its own in section 1c.
os.environ["OUTBOUND_SENDER"] = "ghl"

import ghl  # noqa: E402

CLIENT = {
    "slug": "contract-test",
    "name": "Contract Test Ltd",
    "email": "owner@example.com",
    "deployed_url": "https://contract-test.grayreserve.agency",
}

_failures: list[str] = []
_ran = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global _ran
    _ran += 1
    if cond:
        print(f"  ok   {name}")
    else:
        _failures.append(name)
        print(f"  FAIL {name}{f' - {detail}' if detail else ''}")


def tags(stage: str) -> list:
    return ghl.build_contact_payload(CLIENT, stage=stage)["tags"]


print("\n1. The tag string still matches the live workflow trigger\n")
check(
    'the trigger tag is exactly "demo-built"',
    ghl.DEFAULT_DEMO_SENT_TAG == "demo-built",
    f"got {ghl.DEFAULT_DEMO_SENT_TAG!r} - if the workflow trigger was renamed, "
    "change BOTH; if it was not, this is a silent de-enrolment",
)

print("\n1b. THE TAG IS A SEND BUTTON - it obeys OUTREACH_ENABLED\n")
# Once the workflow is published, applying `demo-built` makes GHL email a real
# business. OUTREACH_ENABLED gates /outreach but NOT /deploy, and the mirror
# fires from update_deployed_url - so without this, deploying during an
# evaluation would email a real prospect. Fail-closed on anything but "true".
for val, may in (("false", False), ("", False), ("TRUE", True), ("1", False),
                 ("yes", False)):
    os.environ["OUTREACH_ENABLED"] = val
    check(
        f'OUTREACH_ENABLED={val!r} -> {"enrols" if may else "does NOT enrol"}',
        ("demo-built" in tags("deploy")) is may,
        "an unrecognised value must never be treated as permission to send",
    )
os.environ.pop("OUTREACH_ENABLED", None)
check(
    "OUTREACH_ENABLED unset -> does NOT enrol",
    "demo-built" not in tags("deploy"),
)

print("\n1c. OUTBOUND_SENDER decides WHO sends - the two are exclusive\n")
# Gating only on OUTREACH_ENABLED armed both senders at once: /outreach
# (gmail.py) AND the GHL workflow, i.e. two first-touch emails from two
# addresses on the same day. Sender choice is its own variable.
os.environ["OUTREACH_ENABLED"] = "true"
for snd, may in (("ghl", True), ("mailbox", False), ("", False), ("GHL", True)):
    os.environ["OUTBOUND_SENDER"] = snd
    check(
        f'OUTBOUND_SENDER={snd!r} -> {"tags (GHL sends)" if may else "no tag (gmail.py sends)"}',
        ("demo-built" in tags("deploy")) is may,
        "in mailbox mode the tag must never be applied, or the prospect gets "
        "two first-touch emails",
    )
os.environ.pop("OUTBOUND_SENDER", None)
check(
    "OUTBOUND_SENDER unset defaults to mailbox -> no tag",
    "demo-built" not in tags("deploy"),
    "defaulting to ghl would silently hand sending to a workflow nobody chose",
)
os.environ["OUTBOUND_SENDER"] = "ghl"

print("\n2. Deploy enrols; outreach-sent does not re-enrol\n")
os.environ["OUTREACH_ENABLED"] = "true"
check(
    "deploy applies the workflow trigger tag",
    tags("deploy") == [ghl.MIRROR_TAG, "demo-built"],
    f"got {tags('deploy')} - the prospect never enters GR-598 Demo-First Send",
)
check(
    "outreach_sent does NOT re-apply it",
    tags("outreach_sent") == [ghl.MIRROR_TAG],
    f"got {tags('outreach_sent')} - this is the double-first-touch bug",
)
check(
    "provenance tag is on BOTH stages",
    ghl.MIRROR_TAG in tags("deploy") and ghl.MIRROR_TAG in tags("outreach_sent"),
    "without it, Klaudius rows are indistinguishable from platform-ETL rows",
)

print("\n3. The off-switch is real\n")
# _env() treats an empty value as unset and returns the default, so an empty
# GHL_DEMO_SENT_TAG would silently re-enable the very tag it meant to disable.
# get_config() reads os.environ directly for this one key; pin that.
os.environ["GHL_DEMO_SENT_TAG"] = ""
check(
    "GHL_DEMO_SENT_TAG= (present but empty) really disables the tag",
    tags("deploy") == [ghl.MIRROR_TAG],
    f"got {tags('deploy')} - the documented kill-switch does not work",
)
os.environ["GHL_DEMO_SENT_TAG"] = "some-other-tag"
check(
    "GHL_DEMO_SENT_TAG overrides the default",
    tags("deploy") == [ghl.MIRROR_TAG, "some-other-tag"],
)
os.environ.pop("GHL_DEMO_SENT_TAG", None)

print("\n4. db.py calls the mirror at BOTH points, with the right stage\n")
db_src = (ROOT / "scripts" / "db.py").read_text()
check(
    "update_deployed_url mirrors with stage='deploy'",
    '_mirror_to_ghl(slug, row, stage="deploy")' in db_src,
    "deploy-time enrolment is the whole mechanism - without it nothing sends",
)
check(
    "set_outreach_sent mirrors with stage='outreach_sent'",
    '_mirror_to_ghl(slug, row, stage="outreach_sent")' in db_src,
    "a bare _mirror_to_ghl(slug, row) defaults to stage='deploy' and re-tags",
)

print(f"\n  {_ran - len(_failures)} passed, {len(_failures)} failed\n")
if _failures:
    for f in _failures:
        print(f"   x {f}")
    print()
    sys.exit(1)
sys.exit(0)
