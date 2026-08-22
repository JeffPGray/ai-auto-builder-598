#!/usr/bin/env python3
"""cost_ledger.py - per-build cost tracking, internal only.

TWO SINKS, ON PURPOSE
---------------------
1. `data/cost-ledger.jsonl` - append-only local record, one JSON object per
   line. Survives independently of GoHighLevel and is the thing to sum when
   asking "what did this week actually cost."
2. GHL custom fields on the contact - `contact.gr_build_cost_usd` (MONETORY)
   and `contact.gr_build_cost_detail` (TEXT), created 2026-08-15. Custom
   fields are visible only to the team inside the CRM; a client never sees
   them, and they sit next to the opportunity value so cost and revenue read
   off one record.

WHY IT MUST NEVER TOUCH THE SITE
--------------------------------
The deployed artefact is `clients/<slug>/site/`. Anything under that directory
can end up in a static export, a server bundle, a sourcemap or a public
`/_next/` asset. What we paid to build a prospect's site is commercially
sensitive: a business owner who finds it learns our margin mid-negotiation.

So the ledger lives at `app/data/`, a sibling of `clients/`, never inside it,
and `assert_no_bleed()` below is a hard check that this stayed true. It is
cheap and it runs on every write, because "we moved it once and nobody
noticed" is exactly how this leaks.

NOTHING HERE RAISES INTO THE PIPELINE. A cost-tracking failure must never
cost a build or a send - same contract as the GHL mirror.

CLI
---
    python3 scripts/cost_ledger.py record SLUG --usd 4.86 --note "12 Opus calls"
    python3 scripts/cost_ledger.py show SLUG
    python3 scripts/cost_ledger.py total [--since 2026-08-01]
"""
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent
LEDGER = ROOT / "data" / "cost-ledger.jsonl"

# Field ids read live from the sub-account on creation, 2026-08-15.
COST_USD_FIELD_ID = "lAYz0dTn4rgRDSsWJCc7"      # contact.gr_build_cost_usd
COST_DETAIL_FIELD_ID = "2r3cechLFuu18lDYE4zN"   # contact.gr_build_cost_detail



# ---------------------------------------------------------------------------
# Plan-usage measurement (the number Jeff actually sees)
# ---------------------------------------------------------------------------
#
# Klaudius generation runs on a Claude Code SUBSCRIPTION, not a metered API
# key, so "dollars per build" is the wrong unit for the build itself - the
# real constraint is PERCENTAGE OF THE PLAN consumed, which is what the UI
# shows. The CLI exposes no usage command, so percentage cannot be read
# programmatically. Tokens CAN be: every assistant turn in a session
# transcript carries a `usage` block.
#
# So: measure tokens exactly, and convert to percent from ONE calibration
# point the operator reads off the UI. Calibrate once, and every later build
# reports a percentage without anyone reading anything.
CLAUDE_PROJECTS = Path.home() / ".claude" / "projects"

# tokens-per-1%-of-plan, written by `calibrate`. No default: a guessed
# constant would produce confident, wrong percentages, which is worse than
# reporting "not calibrated".
CALIB_FILE = ROOT / "data" / "plan-calibration.json"

# Build start-times, so build-end can report wall clock as well as tokens.
MARK = ROOT / "data" / "build-marks.json"

# ── file_lock() — mkdir-based mutex, matching scripts/lib/file-lock.mjs's protocol ─────────────
# WHY: found 2026-08-20 answering "can 3-4 sites run in parallel". build-marks.json is read-
# modify-written by build-start/build-end with NO lock, same shape as the design-fingerprints.json
# race the Node side (scripts/lib/file-lock.mjs) already fixed 2026-08-18 for design-ledger.mjs /
# font-uniqueness-check.mjs / copy-fingerprint-check.mjs. This file was the one writer left
# unprotected. Same lock-dir NAME convention (`<path>.lock`, atomic mkdir) so a Python writer and a
# Node writer contend correctly on the same physical file if they were ever pointed at one, even
# though neither implementation imports the other's code.
import contextlib
import shutil as _shutil

_LOCK_STALE_S = 30
_LOCK_POLL_S = 0.05
_LOCK_MAX_WAIT_S = 10


@contextlib.contextmanager
def file_lock(target: Path):
    lock_dir = Path(str(target) + ".lock")
    deadline = time.time() + _LOCK_MAX_WAIT_S
    while True:
        try:
            lock_dir.mkdir()
            break
        except FileExistsError:
            try:
                age = time.time() - lock_dir.stat().st_mtime
                if age > _LOCK_STALE_S:
                    _shutil.rmtree(lock_dir, ignore_errors=True)
                    continue
            except FileNotFoundError:
                continue  # released between our failed mkdir and this stat
            if time.time() > deadline:
                raise TimeoutError(
                    f"file_lock: timed out waiting for {lock_dir} after {_LOCK_MAX_WAIT_S}s "
                    "— a concurrent process is holding it far longer than expected")
            time.sleep(_LOCK_POLL_S)
    try:
        yield
    finally:
        _shutil.rmtree(lock_dir, ignore_errors=True)



def _usage_by_message_id(path: Path, by_id: dict) -> None:
    """Fold one transcript's usage blocks into by_id, deduped per API call.

    BUG FOUND 2026-08-16 (Fable review, klaudius token-cost audit): Claude Code writes one
    JSONL line PER CONTENT BLOCK, and every line of the same streamed API response repeats
    the full `usage` object. Summing every line — the previous behaviour — inflated
    cache_write ~3.9x and cache_read ~2.2x on a measured real build (540 usage-bearing lines,
    only 234 distinct API calls by message.id). `output_tokens` specifically ACCUMULATES
    across a message's streamed lines (it's a running total), so it needs max() per id, not
    sum(); input/cache_write/cache_read are constant across one message's lines, so max() is
    also correct there (and safe either way, since duplicates of an unchanged value have no
    effect under max()). Keying by `message.id` and maxing each field, rather than summing
    lines, is what turns "540 usage lines" back into "234 real API calls".
    """
    try:
        for line in path.read_text(errors="replace").splitlines():
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            msg = d.get("message") or {}
            u = msg.get("usage") or {}
            if not u:
                continue
            mid = msg.get("id") or f"{path}:{d.get('timestamp', '')}"
            slot = by_id.setdefault(
                mid, {"input": 0, "output": 0, "cache_write": 0, "cache_read": 0}
            )
            slot["input"] = max(slot["input"], u.get("input_tokens", 0) or 0)
            slot["output"] = max(slot["output"], u.get("output_tokens", 0) or 0)
            slot["cache_write"] = max(
                slot["cache_write"], u.get("cache_creation_input_tokens", 0) or 0
            )
            slot["cache_read"] = max(
                slot["cache_read"], u.get("cache_read_input_tokens", 0) or 0
            )
    except OSError:
        pass


def session_tokens(path: Path) -> dict:
    """Exact token totals for one session, INCLUDING everything it delegated.

    BUG FOUND 2026-08-16 (same review as above): a build's subagent spawns (QA reviewer,
    blog-prose writer, auto-compaction summarizers) write their own transcripts to
    `<session-id>/subagents/*.jsonl`, a sibling directory `sessions_since()` never scanned —
    so a build's real cost was undercounted by everything it delegated. On the measured build,
    the QA subagent alone was another ~1.59M true-weighted tokens (25% of the whole build) that
    the top-level number silently dropped. "The session's tokens" means the session PLUS
    whatever it spawned to get the work done, not just its own top-level transcript.
    """
    by_id: dict = {}
    _usage_by_message_id(path, by_id)
    subagent_dir = path.with_suffix("") / "subagents"
    if subagent_dir.is_dir():
        for sub_path in sorted(subagent_dir.glob("*.jsonl")):
            _usage_by_message_id(sub_path, by_id)

    t = {"input": 0, "output": 0, "cache_write": 0, "cache_read": 0}
    for slot in by_id.values():
        for k in t:
            t[k] += slot[k]
    t["turns"] = len(by_id)
    # Cache READS are billed far below fresh input, and on a subscription the
    # plan meter tracks something closer to total work. Report the raw parts
    # and a weighted total so the calibration is against ONE stable number.
    t["weighted"] = (
        t["input"] + t["output"] + t["cache_write"] + int(t["cache_read"] * 0.1)
    )
    return t


def sessions_since(ts: float, project: str = "") -> list:
    """Top-level session transcripts modified since a unix timestamp, newest first.

    `project` scopes to one project directory. This matters more than it
    looks: without it, a build measured while the operator is also holding a
    conversation in another Claude window counts BOTH, and the build's cost
    reads as several times its real value. Measured 2026-08-16 - a 2-second
    smoke test reported 1.29% of plan because eight other sessions were live.

    The project dir name is the cwd with `/` and `.` replaced by dashes, e.g.
    /Users/x/Github/klaudius/app -> -Users-x-Github-klaudius-app
    /Users/x/Github/klaudius/.worktrees/foo/app -> -Users-x-Github-klaudius--worktrees-foo-app.

    BUG FOUND 2026-08-17 (Fable review, token/compaction audit): a build's
    subagent transcripts live under `<session-id>/subagents/*.jsonl`, which
    `rglob` walks into and returned as independent top-level files. Every
    caller that sums `session_tokens()` over this list (build-end chief
    among them) already gets a subagent's usage FOR FREE, because
    `session_tokens()` folds its own subagents directory in (see its
    docstring). Returning those same subagent files a second time as their
    own top-level entries double-counted them — measured +19.7% on a real
    archived build (4,649,776 the old way vs 3,884,252 deduped). Skip
    anything with a `subagents` path segment; it belongs to its parent.
    """
    out = []
    root = CLAUDE_PROJECTS / project if project else CLAUDE_PROJECTS
    if root.exists():
        for f in root.rglob("*.jsonl"):
            if "subagents" in f.parts:
                continue
            try:
                if f.stat().st_mtime >= ts:
                    out.append(f)
            except OSError:
                continue
    return sorted(out, key=lambda f: f.stat().st_mtime, reverse=True)


def attribution_looks_wrong(minutes: float, turns: int, weighted: int) -> str:
    """Return a warning string when a build's measured cost is implausible.

    Silent under-attribution is the dangerous failure here, because the number
    looks like a measurement and gets quoted. Measured 2026-08-16: a rebuild
    that ran 59.5 minutes and rewrote an entire site recorded 28,442 weighted
    tokens across 1 turn, while a comparable clean run recorded 6,082,536
    across 409. The child had been killed mid-flight and its session file was
    not attributed.

    So rather than trust or silently drop it, flag it. A build that took real
    wall-clock but shows almost no turns did not cost nothing - it was measured
    wrong, and quoting it would understate plan usage by two orders of
    magnitude.
    """
    if minutes >= 5 and turns <= 5:
        return (f"ATTRIBUTION SUSPECT: {minutes:.1f} min but only {turns} turn(s). "
                "A killed or externally-run child's transcript was probably missed. "
                "Do NOT quote this as a per-build cost.")
    if minutes >= 5 and weighted < 500_000:
        return (f"ATTRIBUTION SUSPECT: {minutes:.1f} min but only {weighted:,} weighted tokens. "
                "Comparable clean builds record millions. Treat as unmeasured.")
    return ""


def project_dir_for(path: str) -> str:
    """Claude's project-dir name for a filesystem path.

    Claude Code replaces BOTH `/` and `.` with `-`. Measured on worktrees:
      /Users/.../klaudius/.worktrees/klaudius-speed/app
        → -Users-...-klaudius--worktrees-klaudius-speed-app
    Replacing only `/` left `.worktrees` intact and pointed metering + live-ledger
    at a directory that does not exist — every worktree build-end recorded 0 sessions.
    """
    return str(Path(path).resolve()).replace("/", "-").replace(".", "-")


def load_calibration() -> Optional[float]:
    try:
        return float(json.loads(CALIB_FILE.read_text())["tokens_per_percent"])
    except Exception:
        return None


def pct_for(weighted: int) -> Optional[float]:
    tpp = load_calibration()
    return round(weighted / tpp, 3) if tpp else None


def stage_breakdown(path: Path) -> list:
    """Attribute token usage to PIPELINE STAGES within one session transcript.

    This is the measurement that decides whether model tiering is worth
    building at all. Ruflo-style tiering routes each stage to the cheapest
    model that can do it - but if /build dominates total usage, tiering
    /find, /gather, QA and /deploy saves almost nothing while adding a
    multi-process pipeline and every failure mode that brings. Nobody can
    answer that from a single per-build total, which is all we had.

    Method: walk the transcript in order; every Skill invocation opens a new
    bucket, and each assistant turn's usage lands in the bucket currently
    open. Turns before any Skill call go to "orchestration" - the session's
    own reasoning, which is itself worth seeing, because if orchestration is
    large then splitting into per-stage processes pays that cost N times.

    BUG FOUND 2026-08-17 (Fable review, token/compaction audit): this walked
    every JSONL line and summed its usage block directly, the exact
    per-line-not-per-message-id bug `_usage_by_message_id` was written to
    fix elsewhere (see its docstring - one streamed API response repeats its
    usage object across many lines). Measured ~1.9x inflation here (382
    usage-bearing lines vs 200 distinct message ids on one build). Fixed the
    same way: dedupe by message.id, max() each field. A message's lines are
    always contiguous, so tracking "the currently-open message id" per stage
    bucket is enough - a message never straddles two stages.
    """
    stages = []
    cur = {"stage": "orchestration", "weighted": 0, "turns": 0}
    cur_ids: dict = {}  # message.id -> usage dict, scoped to the CURRENT stage bucket
    try:
        lines = path.read_text(errors="replace").splitlines()
    except OSError:
        return []
    for line in lines:
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        msg = d.get("message") or {}

        # A Skill tool_use marks the start of a stage.
        for blk in (msg.get("content") or []) if isinstance(msg.get("content"), list) else []:
            if isinstance(blk, dict) and blk.get("type") == "tool_use" and blk.get("name") == "Skill":
                name = (blk.get("input") or {}).get("skill") or "?"
                if cur["turns"]:
                    stages.append(cur)
                cur = {"stage": name, "weighted": 0, "turns": 0}
                cur_ids = {}

        u = msg.get("usage") or {}
        if u:
            mid = msg.get("id") or f"{path}:{d.get('timestamp', '')}"
            is_new = mid not in cur_ids
            slot = cur_ids.setdefault(
                mid, {"input": 0, "output": 0, "cache_write": 0, "cache_read": 0}
            )
            slot["input"] = max(slot["input"], u.get("input_tokens", 0) or 0)
            slot["output"] = max(slot["output"], u.get("output_tokens", 0) or 0)
            slot["cache_write"] = max(
                slot["cache_write"], u.get("cache_creation_input_tokens", 0) or 0
            )
            slot["cache_read"] = max(
                slot["cache_read"], u.get("cache_read_input_tokens", 0) or 0
            )
            if is_new:
                cur["turns"] += 1
            cur["weighted"] = sum(
                s["input"] + s["output"] + s["cache_write"] + int(s["cache_read"] * 0.1)
                for s in cur_ids.values()
            )
    if cur["turns"]:
        stages.append(cur)

    # Merge repeated invocations of the same stage (build -> qa-fix -> build).
    merged = {}
    for st in stages:
        m = merged.setdefault(st["stage"], {"stage": st["stage"], "weighted": 0, "turns": 0, "invocations": 0})
        m["weighted"] += st["weighted"]
        m["turns"] += st["turns"]
        m["invocations"] += 1
    return sorted(merged.values(), key=lambda x: -x["weighted"])


def assert_no_bleed(path: Path = LEDGER) -> None:
    """Refuse to write anywhere that could be deployed.

    `clients/<slug>/site/` is the build output. If the ledger ever ends up
    under it - by a refactor, a symlink, or someone 'tidying' paths - a static
    export would happily publish our build costs to the prospect's own domain.
    Resolve both sides so a symlink cannot sneak past a string comparison.
    """
    resolved = path.resolve()
    clients = (ROOT / "clients").resolve()
    if clients in resolved.parents:
        raise RuntimeError(
            f"cost ledger path {resolved} is inside {clients} - it would be "
            "deployed with a client site. Costs are internal; move it back "
            "to app/data/."
        )


def session_id_from_log(log_path: str) -> Optional[str]:
    """Pull the `session_id` a dispatcher wrote into its own log.

    GROUND TRUTH for attribution: the dispatcher knows which session it
    launched, so nothing downstream has to infer it from timestamps. Inference
    is what broke - see claim_sessions(). A killed run leaves a 0-byte log by
    construction (`claude -p` buffers until exit), so this returns None there
    and the caller falls back to the `seen` filter alone.
    """
    try:
        lines = Path(log_path).read_text(errors="replace").splitlines()
    except OSError:
        return None
    for line in lines:
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            d = json.loads(line)
        except Exception:  # noqa: BLE001 - a partial line is not fatal
            continue
        sid = d.get("session_id") or d.get("sessionId")
        if sid:
            return str(sid)
    return None


def claim_sessions(files: list, session_id: Optional[str], slug: str = "") -> list:
    """Keep only the transcript this dispatch actually launched.

    WHY THIS IS ID-BASED AND NOT TIME-BASED (2026-08-20, MS septic campaign).
    `seen` excludes every transcript that existed at build-start, which
    isolates a build from earlier siblings but never from one that starts
    LATER - that sibling's transcript did not exist yet, so it could not be in
    `seen`. Under parallel lanes aaa-septic-systems-ms and laceys-digging-ms
    were both recorded at 966,398 weighted tokens, the identical figure two
    seconds apart, each having counted the other.

    The first attempt at a fix inferred ownership from time: a transcript
    belongs to the latest build that started before its first event. That is
    WRONG and it silently zeroed a real build. A dispatch does not create its
    transcript at build-start - it lags by minutes - so a sibling starting
    inside that lag looks like the better owner. diers-vacuum-service-ms
    began 5+ minutes after its own build-start, by which point two siblings
    had started, and the rule handed its transcript away: 0 sessions, 0
    tokens, on a 20-minute build that had completed successfully. An
    under-count reads as a cheap build, which is the dangerous direction when
    these numbers set capacity.

    So attribution never guesses. The dispatcher records the session it
    launched; we match on that id and nothing else. With no id available we
    fall back to the `seen` filter alone - the pre-existing over-count, which
    is wrong in the safe direction and was the behaviour before today.
    """
    if session_id:
        return [f for f in files if f.stem == session_id]
    if slug:
        # No session id: the run was killed, so `claude -p` never flushed its buffered log.
        # Fall back to OWNERSHIP - a dispatch names its client directory in its opening prompt,
        # so the transcript says whose it is. Same test the watchdog's resolver uses. Bounded
        # head read: these files reach megabytes.
        owned = []
        for f in files:
            try:
                with f.open(errors="replace") as fh:
                    for i, line in enumerate(fh):
                        if i >= 400:
                            break
                        if f"clients/{slug}" in line:
                            owned.append(f)
                            break
            except OSError:
                continue
        # Only trust it if it found something; an empty result means the probe failed, and
        # under-counting a real build is the more dangerous direction.
        return owned or files
    return files


def record(slug: str, usd: float, note: str = "", stage: str = "build") -> dict:
    """Append one cost line. Returns the entry. Never raises into the caller."""
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "slug": slug,
        "usd": round(float(usd), 4),
        "stage": stage,
        "note": note,
    }
    try:
        assert_no_bleed()
        LEDGER.parent.mkdir(parents=True, exist_ok=True)
        with LEDGER.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry) + "\n")
    except Exception as exc:  # noqa: BLE001 - tracking must not break a build
        print(f"cost ledger write failed for {slug}: {exc}", file=sys.stderr)
    return entry


def entries(slug: str = "") -> list:
    """All ledger lines, optionally for one slug. Missing file = []."""
    if not LEDGER.exists():
        return []
    out = []
    for line in LEDGER.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            # One corrupt line must not hide every other cost. Append-only
            # files get truncated by a crash mid-write; skip and carry on.
            continue
        if not slug or e.get("slug") == slug:
            out.append(e)
    return out


def total_for(slug: str) -> float:
    return round(sum(e.get("usd", 0) for e in entries(slug)), 4)


def summary_for(slug: str) -> str:
    """The one-line string written to contact.gr_build_cost_detail."""
    es = entries(slug)
    if not es:
        return ""
    by_stage: dict = {}
    for e in es:
        by_stage[e.get("stage", "?")] = by_stage.get(e.get("stage", "?"), 0) + e.get("usd", 0)
    parts = ", ".join(f"{k} ${v:.2f}" for k, v in sorted(by_stage.items()))
    return f"${total_for(slug):.2f} total ({len(es)} entries: {parts})"


def ghl_custom_fields(slug: str) -> list:
    """Cost fields for a contact upsert, or [] when nothing is recorded.

    Returned in the by-id `field_value` shape - GHL silently drops an unknown
    key and still answers 2xx, so writing by name would fail invisibly.
    """
    total = total_for(slug)
    if not total:
        return []
    return [
        {"id": COST_USD_FIELD_ID, "field_value": f"{total:.2f}"},
        {"id": COST_DETAIL_FIELD_ID, "field_value": summary_for(slug)},
    ]


def main() -> int:
    args = sys.argv[1:]
    cmd = args[0] if args else ""
    if cmd == "record" and len(args) >= 2:
        slug = args[1]
        usd = 0.0
        note = ""
        stage = "build"
        for i, a in enumerate(args):
            if a == "--usd" and i + 1 < len(args):
                usd = float(args[i + 1])
            if a == "--note" and i + 1 < len(args):
                note = args[i + 1]
            if a == "--stage" and i + 1 < len(args):
                stage = args[i + 1]
        print(json.dumps(record(slug, usd, note, stage), indent=2))
        print(f"\n{slug}: {summary_for(slug)}")
        return 0
    if cmd == "show" and len(args) >= 2:
        slug = args[1]
        for e in entries(slug):
            print(f"  {e['ts']}  {e['stage']:9} ${e['usd']:>7.2f}  {e.get('note','')}")
        print(f"\n{slug}: {summary_for(slug) or 'nothing recorded'}")
        return 0
    if cmd == "build-start":
        # Stamp the start of a build so build-end can measure elapsed time AND
        # attribute exactly the token usage that happened inside the window.
        # Wall-clock matters independently of tokens: at 50-100 builds/day it
        # is what decides how many fit in a working session.
        if len(args) < 2:
            print("usage: cost_ledger.py build-start SLUG"); return 1
        slug = args[1]
        MARK.parent.mkdir(parents=True, exist_ok=True)
        with file_lock(MARK):
            marks = json.loads(MARK.read_text()) if MARK.exists() else {}
            # Snapshot the session transcripts that ALREADY exist. Any .jsonl that
            # appears after this is, by construction, a session started for this
            # build — which is what makes two CONCURRENT builds separable. Without
            # it, both children write into the same project dir and their costs are
            # indistinguishable, so the per-build number (the whole point) is lost.
            existing = sorted(str(f) for f in sessions_since(0, project_dir_for(ROOT)))
            marks[slug] = {"t": time.time(), "seen": existing}
            MARK.write_text(json.dumps(marks, indent=2))
        print(f"build-start {slug} @ {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
        return 0

    if cmd == "build-end":
        if len(args) < 2:
            print("usage: cost_ledger.py build-end SLUG"); return 1
        slug = args[1]
        with file_lock(MARK):
            marks = json.loads(MARK.read_text()) if MARK.exists() else {}
            mark = marks.get(slug)
            if mark is not None:
                marks.pop(slug, None)
                MARK.write_text(json.dumps(marks, indent=2))
        if not mark:
            print(f"no build-start recorded for {slug} — run build-start first"); return 1
        # Back-compat: older marks were a bare float.
        if isinstance(mark, (int, float)):
            start, seen = float(mark), []
        else:
            start, seen = float(mark["t"]), mark.get("seen", [])
        elapsed = time.time() - start
        # Scope to THIS project's sessions. The build runs as a headless
        # `claude -p` child with cwd = app/, so its transcript lands in this
        # project dir; the operator's own conversation lives elsewhere and is
        # correctly excluded. Pass --all-projects to opt out.
        proj = "" if "--all-projects" in args else project_dir_for(ROOT)
        files = sessions_since(start, proj)
        # Keep only transcripts that did NOT exist at build-start. That is what
        # isolates THIS build from a sibling build running concurrently in the
        # same project dir, and from the operator's own session.
        if seen:
            seen_set = set(seen)
            files = [f for f in files if str(f) not in seen_set]
        # `seen` only excludes siblings that started EARLIER. A sibling that
        # starts LATER is invisible to it, so under parallel lanes every build
        # counted every other one. See claim_sessions().
        sid = None
        if "--session" in args:
            sid = args[args.index("--session") + 1]
        elif "--log" in args:
            sid = session_id_from_log(args[args.index("--log") + 1])
        files = claim_sessions(files, sid, slug)
        agg = {"input":0,"output":0,"cache_write":0,"cache_read":0,"weighted":0,"turns":0}
        for f in files:
            t = session_tokens(f)
            for k in agg: agg[k] += t[k]
        pct = pct_for(agg["weighted"])
        mins = elapsed / 60
        print(f"=== {slug} ===")
        how = "matched to this dispatch's session id" if sid else "NO session id - siblings may be included"
        print(f"  sessions       {len(files)} ({how})")
        print(f"  wall clock     {mins:,.1f} min")
        print(f"  turns          {agg['turns']:,}")
        print(f"  weighted tok   {agg['weighted']:,}")
        if pct is not None:
            print(f"  plan usage     {pct}%")
            if pct > 0:
                print(f"  -> {100/pct:,.0f} builds per plan period at this size")
                print(f"  -> {(7*24*60)/mins:,.0f} builds/week if run back-to-back (time-bound)")
        else:
            print("  plan usage     NOT CALIBRATED")
        record(slug, 0.0, stage="build-total",
               note=f"{mins:.1f} min, {agg['weighted']:,} weighted tokens"
                    + (f", {pct}% of plan" if pct is not None else ""))
        # ARCHIVE, do not delete. Popping the mark destroyed the only record
        # of which session transcripts belonged to this build, so the run could
        # never be re-analysed — a per-stage breakdown or a turn-level
        # comparison becomes impossible the moment build-end runs once.
        # Measured 2026-08-16: re-deriving the input/output/cache split for the
        # two completed builds was impossible for exactly this reason.
        done_file = ROOT / "data" / "build-marks-done.json"
        with file_lock(done_file):
            try:
                archive = json.loads(done_file.read_text()) if done_file.exists() else {}
            except json.JSONDecodeError:
                archive = {}
            archive.setdefault(slug, []).append({
                "t": start, "seen": seen if isinstance(seen, list) else sorted(seen),
                "ended": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "minutes": round(mins, 1), "weighted": agg["weighted"],
                "turns": agg["turns"], "plan_pct": pct,
                "sessions": [str(f) for f in files],
            })
            done_file.write_text(json.dumps(archive, indent=2))
        print(f"\n  recorded to the ledger")
        return 0

    if cmd == "stages":
        # Per-stage breakdown for a build. THE number that decides whether
        # model tiering is worth building: if /build dominates, tiering the
        # rest saves almost nothing.
        if len(args) < 2:
            print("usage: cost_ledger.py stages SLUG"); return 1
        slug = args[1]
        marks = json.loads(MARK.read_text()) if MARK.exists() else {}
        mark = marks.get(slug)
        if mark is None:
            print(f"no build mark for {slug}"); return 1
        start = float(mark) if isinstance(mark, (int, float)) else float(mark["t"])
        seen = set() if isinstance(mark, (int, float)) else set(mark.get("seen", []))
        files = [f for f in sessions_since(start, project_dir_for(ROOT)) if str(f) not in seen]
        agg = {}
        for f in files:
            for st in stage_breakdown(f):
                m = agg.setdefault(st["stage"], {"weighted": 0, "turns": 0, "invocations": 0})
                for k in ("weighted", "turns", "invocations"):
                    m[k] += st[k]
        total = sum(v["weighted"] for v in agg.values()) or 1
        print(f"=== {slug} — per-stage usage ({len(files)} session(s)) ===")
        print(f"  {'stage':22} {'weighted':>14} {'share':>7} {'turns':>6} {'runs':>5}   plan %")
        for name, v in sorted(agg.items(), key=lambda kv: -kv[1]["weighted"]):
            pct = pct_for(v["weighted"])
            print(f"  {name:22} {v['weighted']:>14,} {100*v['weighted']/total:>6.1f}% "
                  f"{v['turns']:>6} {v['invocations']:>5}   {pct if pct is not None else '-'}")
        print(f"  {'TOTAL':22} {total:>14,} {100.0:>6.1f}%")
        tp = pct_for(total)
        if tp: print(f"\n  whole build: {tp}% of plan")
        return 0

    if cmd == "history":
        # Every completed build, so runs stay comparable after the fact.
        f = ROOT / "data" / "build-marks-done.json"
        if not f.exists():
            print("no completed builds recorded yet"); return 0
        arch = json.loads(f.read_text())
        print(f"  {'slug':24} {'ended':20} {'min':>6} {'weighted':>13} {'turns':>7} {'plan %':>8}")
        for slug, runs in arch.items():
            for r in runs:
                print(f"  {slug[:24]:24} {r.get('ended','')[:19]:20} {r.get('minutes',0):>6.1f} "
                      f"{r.get('weighted',0):>13,} {r.get('turns',0):>7,} "
                      f"{(r.get('plan_pct') or 0):>8.4f}")
        return 0

    if cmd == "calibrate":
        # One-time: operator reads plan % off the Claude Code UI before and
        # after a stretch of work; we know the tokens exactly. That single
        # data point converts every future build to a percentage.
        pct = None
        toks = None
        for i, a in enumerate(args):
            if a == "--percent" and i + 1 < len(args):
                pct = float(args[i + 1])
            if a == "--since-hours" and i + 1 < len(args):
                toks = sum(session_tokens(f)["weighted"]
                           for f in sessions_since(time.time() - float(args[i + 1]) * 3600))
        if pct is None or not toks:
            print("usage: cost_ledger.py calibrate --percent 12.5 --since-hours 3")
            print("  (percent = how much of the plan the UI says you burned in that window)")
            return 1
        tpp = toks / pct
        CALIB_FILE.parent.mkdir(parents=True, exist_ok=True)
        CALIB_FILE.write_text(json.dumps({
            "tokens_per_percent": tpp,
            "calibrated_from": {"percent": pct, "weighted_tokens": toks},
            "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "note": "Plan tier is baked in. Re-calibrate if the plan changes.",
        }, indent=2))
        print(f"calibrated: {toks:,} weighted tokens = {pct}% of plan")
        print(f"  -> {tpp:,.0f} tokens per 1% of plan")
        print(f"  written to {CALIB_FILE}")
        return 0

    if cmd == "measure":
        # Tokens (and % if calibrated) for work done in a recent window.
        hours = 1.0
        slug = ""
        for i, a in enumerate(args):
            if a == "--since-hours" and i + 1 < len(args):
                hours = float(args[i + 1])
            if a == "--slug" and i + 1 < len(args):
                slug = args[i + 1]
        files = sessions_since(time.time() - hours * 3600)
        agg = {"input": 0, "output": 0, "cache_write": 0, "cache_read": 0,
               "weighted": 0, "turns": 0}
        for f in files:
            t = session_tokens(f)
            for k in agg:
                agg[k] += t[k]
        print(f"{len(files)} session(s) in the last {hours}h, {agg['turns']} assistant turns")
        for k in ("input", "output", "cache_write", "cache_read", "weighted"):
            print(f"  {k:14} {agg[k]:>14,}")
        pct = pct_for(agg["weighted"])
        if pct is None:
            print("\n  plan %: NOT CALIBRATED — run `calibrate` once (see --help)")
        else:
            print(f"\n  plan usage: {pct}%   ->  {100/pct:,.1f} builds of this size per plan period"
                  if pct else "")
        if slug:
            record(slug, 0.0, note=f"{agg['weighted']:,} weighted tokens"
                   + (f", {pct}% of plan" if pct else ""), stage="build-usage")
            print(f"\n  recorded against {slug}")
        return 0

    if cmd == "total":
        es = entries()
        since = ""
        if "--since" in args:
            since = args[args.index("--since") + 1]
            es = [e for e in es if e.get("ts", "") >= since]
        by_slug: dict = {}
        for e in es:
            by_slug[e["slug"]] = by_slug.get(e["slug"], 0) + e.get("usd", 0)
        for s, v in sorted(by_slug.items(), key=lambda kv: -kv[1]):
            print(f"  {s:38} ${v:>8.2f}")
        n = len(by_slug)
        tot = sum(by_slug.values())
        print(f"\n  {n} builds, ${tot:.2f} total"
              + (f", ${tot/n:.2f} per build" if n else "")
              + (f"  (since {since})" if since else ""))
        return 0

    if cmd == "compare":
        # experiment/speed-cut: print this slug vs hillards baseline from archive.
        if len(args) < 2:
            print("usage: cost_ledger.py compare SLUG [--baseline hillards-septic-ms]"); return 1
        slug = args[1]
        baseline = "hillards-septic-ms"
        if "--baseline" in args:
            baseline = args[args.index("--baseline") + 1]
        done_file = ROOT / "data" / "build-marks-done.json"
        if not done_file.exists():
            print("no completed builds recorded yet"); return 1
        arch = json.loads(done_file.read_text())
        def latest(s: str):
            runs = arch.get(s) or []
            return runs[-1] if runs else None
        cur = latest(slug)
        base = latest(baseline)
        if not cur:
            print(f"no completed run for {slug}"); return 1
        print(f"=== compare {slug} vs {baseline} ===")
        print(f"  {'':12} {'min':>8} {'weighted':>14} {'turns':>8} {'plan %':>10}")
        print(f"  {'this':12} {cur.get('minutes',0):>8.1f} {cur.get('weighted',0):>14,} "
              f"{cur.get('turns',0):>8,} {(cur.get('plan_pct') or 0):>10.4f}")
        if base:
            print(f"  {'baseline':12} {base.get('minutes',0):>8.1f} {base.get('weighted',0):>14,} "
                  f"{base.get('turns',0):>8,} {(base.get('plan_pct') or 0):>10.4f}")
            dm = cur.get("minutes", 0) - base.get("minutes", 0)
            dw = cur.get("weighted", 0) - base.get("weighted", 0)
            print(f"  delta        {dm:>+8.1f} {dw:>+14,}  "
                  f"(target: wall <60 and tokens not worse than ~2.1M)")
        else:
            print(f"  (no archive row for baseline {baseline} — hillards numbers live on the "
                  "operator machine that ran that build)")
            print("  hard baseline from speed-cut-replay.md: hillards 150.4 min / 1.63M weighted")
        return 0

    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main())
