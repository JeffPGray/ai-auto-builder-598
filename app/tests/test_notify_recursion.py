#!/usr/bin/env python3
"""Fork-bomb regression test for scripts/notify.sh.

On 2026-08-15 notify.sh self-recursed to 3,530 live processes from ONE deploy
alert. The user process table filled, every fork() on the machine started
failing EAGAIN, and `npx`, `next build` and eventually `echo` broke for every
other agent session running at the time.

Three defects stacked up. The first two are conditionals, and each was "fixed"
once already:

  1. The fan-out re-invoked self as `NOTIFY_CHANNEL="$c" "$0" ...`. The child
     re-sources .env, which handed the comma list straight back, and it fanned
     out again forever. Fixed by NOTIFY_FORCE_CHANNEL, a name .env never sets.
  2. `${NOTIFY_FORCE_CHANNEL:-...}` used `:-`, so an EMPTY forced channel fell
     back to the comma list and recursed forever. Fixed by `${VAR+set}`, which
     tests presence rather than emptiness.
  3. The NOTIFY_DEPTH backstop added after the second incident was INERT: it
     was read, sanitised, compared and exported, but never incremented, so
     every process in a chain exported 0 and `0 -gt 1` was never true. A guard
     that cannot fire is worse than no guard, because it reads as covered.

This file pins the backstop specifically, because the backstop is the only one
of the three that does not depend on getting the channel logic right. Test 2
below deliberately reintroduces defect 1 and asserts the depth counter contains
it anyway. If someone refactors the fan-out and reopens a recursion path, that
test is what catches it instead of the operator's phone.

SAFETY: every child runs under RLIMIT_NPROC = (current user processes + 25).
An inert counter therefore exhausts a 25-process budget and dies with EAGAIN
rather than taking the machine down, which is exactly what this test must not
reproduce for real. Senders are stubbed with a fake `curl` on PATH, so no
Telegram/Slack/email/SMS traffic leaves the machine.

Run: python3 tests/test_notify_recursion.py
"""
import os
import re
import resource
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
NOTIFY = os.path.join(os.path.dirname(HERE), "scripts", "notify.sh")

_ran = 0
_failures = []


def _check(name, ok, detail=""):
    global _ran
    _ran += 1
    if ok:
        print(f"  . {name}")
    else:
        print(f"  x {name}")
        _failures.append(f"{name}{(' — ' + detail) if detail else ''}")


def _proc_budget():
    """Cap this test's process tree just above current usage.

    RLIMIT_NPROC is per-user and inherited by the whole tree. Setting it to
    current+25 means a runaway recursion inside the test hits EAGAIN after ~25
    forks instead of filling the table. Processes outside the tree keep their
    own limits; they only push our tree into the cap sooner, which fails the
    test safely rather than dangerously.
    """
    current = len(subprocess.run(["ps", "-u", str(os.getuid())],
                                 capture_output=True, text=True).stdout.splitlines())
    return current + 25


_BUDGET = _proc_budget()


def _limit():
    soft, hard = resource.getrlimit(resource.RLIMIT_NPROC)
    resource.setrlimit(resource.RLIMIT_NPROC, (min(_BUDGET, hard), hard))


def _sandbox(tmp, channels, sabotage=False):
    """A throwaway copy of notify.sh with stubbed senders and no real creds."""
    os.makedirs(os.path.join(tmp, "scripts"), exist_ok=True)
    dest = os.path.join(tmp, "scripts", "notify.sh")
    src = open(NOTIFY, encoding="utf-8").read()
    if sabotage:
        # Reintroduce defect 1 verbatim: pass the channel under a name .env
        # DOES set, so the child re-sources .env and gets the comma list back.
        # Only the depth counter can stop this.
        src = src.replace('NOTIFY_FORCE_CHANNEL="$c" "$0" "$MESSAGE"',
                          'NOTIFY_CHANNEL="$c" "$0" "$MESSAGE"')
    with open(dest, "w", encoding="utf-8") as fh:
        fh.write(src)
    os.chmod(dest, 0o755)

    # Credentials are syntactically present so the send branches are actually
    # reached, but every send goes to the stub curl below, never the network.
    with open(os.path.join(tmp, ".env"), "w", encoding="utf-8") as fh:
        fh.write(f"NOTIFY_CHANNEL={channels}\n"
                 "TELEGRAM_BOT_TOKEN=stub\nTELEGRAM_CHAT_ID=stub\n"
                 "SLACK_BOT_TOKEN=stub\nSLACK_CHANNEL=stub\n")

    calls = os.path.join(tmp, "calls.log")
    binn = os.path.join(tmp, "bin")
    os.makedirs(binn, exist_ok=True)
    stub = os.path.join(binn, "curl")
    with open(stub, "w", encoding="utf-8") as fh:
        fh.write("#!/bin/sh\n"
                 f'echo "${{NOTIFY_DEPTH:-unset}}" >> "{calls}"\n'
                 'echo \'{"ok":true}\'\n')
    os.chmod(stub, 0o755)
    return dest, calls, binn


class _TimedOut:
    """Stand-in result for a run that never terminated.

    A missing depth guard does not necessarily die fast: RLIMIT_NPROC makes the
    forks fail, but the loop keeps retrying, so the run hangs instead of
    crashing. Surfacing that as a normal failed assertion keeps the report
    readable — an uncaught TimeoutExpired traceback buries which check broke.
    """
    returncode = -1
    stdout = ""
    stderr = "TIMED OUT — recursion never terminated"


def _run(script, binn, message, timeout=25):
    env = dict(os.environ, PATH=binn + os.pathsep + os.environ["PATH"])
    env.pop("NOTIFY_DEPTH", None)
    env.pop("NOTIFY_FORCE_CHANNEL", None)
    # start_new_session puts the whole run in its own process group so a
    # runaway tree can be reaped with one killpg. Killing by script path
    # instead would race: a process forked microseconds after the pkill
    # survives, and it leaks exactly the processes this test exists to bound.
    def _setup():
        os.setsid()
        _limit()

    proc = subprocess.Popen(["bash", script, message], stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, env=env,
                            preexec_fn=_setup)
    try:
        out, err = proc.communicate(timeout=timeout)
        proc.returncode = proc.returncode  # settled by communicate()
        return subprocess.CompletedProcess(proc.args, proc.returncode, out, err)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, 9)
        except ProcessLookupError:
            pass
        proc.communicate()
        return _TimedOut()


print("\n=== notify.sh fork-bomb regression ===\n")

# --- Test 1: the documented fan-out contract -------------------------------
# Three channels must produce exactly three sends, each one level down. This is
# the shape the feature promises; anything more is the bomb starting.
with tempfile.TemporaryDirectory() as tmp:
    script, calls, binn = _sandbox(tmp, "a,b,c")
    proc = _run(script, binn, "fan-out contract probe")
    depths = [ln.strip() for ln in open(calls).read().splitlines()] if os.path.exists(calls) else []

    _check("NOTIFY_CHANNEL=a,b,c produces exactly 3 sends",
           len(depths) == 3, f"got {len(depths)}: {depths}")
    _check("every send runs at depth 2 (one level below the caller)",
           depths == ["2", "2", "2"], f"got {depths}")
    _check("fan-out exits clean", proc.returncode == 0,
           f"rc={proc.returncode} stderr={proc.stderr[:200]}")

# --- Test 2: the backstop, with defect 1 deliberately reintroduced ----------
# This is the whole point of the file. The fan-out is sabotaged back to the
# original bug, so the channel logic CANNOT terminate the recursion. Only the
# depth counter can. An inert counter (the 2026-08-15 state) makes this run
# until it hits the RLIMIT_NPROC budget.
with tempfile.TemporaryDirectory() as tmp:
    script, calls, binn = _sandbox(tmp, "a,b,c", sabotage=True)
    proc = _run(script, binn, "backstop probe")
    guard_hits = len(re.findall(r"fork-bomb guard", proc.stderr))
    exhausted = "Resource temporarily unavailable" in proc.stderr

    _check("recursion terminates instead of exhausting the process table",
           proc.returncode != -1 and not exhausted,
           proc.stderr.strip()[:120] or "hit RLIMIT_NPROC — the depth guard did not hold")
    _check("the depth guard actually fires on the sabotaged fan-out",
           guard_hits > 0, "guard never printed; counter is inert again")
    _check("guard bounds the blast radius to a handful of processes",
           0 < guard_hits <= 16, f"guard fired {guard_hits}x — bound has drifted")

# --- Test 3: static guard against the counter going inert again ------------
# Tests 1 and 2 are behavioural, but an inert counter is a one-word regression
# (dropping the increment) that reads as harmless in review. Pin it literally.
src = open(NOTIFY, encoding="utf-8").read()
_check("NOTIFY_DEPTH is incremented, not merely read and re-exported",
       re.search(r"NOTIFY_DEPTH=\$\(\(\s*NOTIFY_DEPTH\s*\+\s*1\s*\)\)", src) is not None,
       "no increment found — the guard can never fire")
_check("NOTIFY_DEPTH is exported so children inherit the count",
       "export NOTIFY_DEPTH" in src)
_check("forced channel is resolved by presence (${VAR+set}), not `:-`",
       "${NOTIFY_FORCE_CHANNEL+set}" in src,
       "`:-` lets an EMPTY forced channel fall back to the comma list")

print(f"\n  {_ran - len(_failures)} passed, {len(_failures)} failed\n")
if _failures:
    for f in _failures:
        print(f"   x {f}")
    print()
    sys.exit(1)
sys.exit(0)
