#!/usr/bin/env python3
"""Launch dispatch-build.sh in a new session so Cursor/agent shell death cannot reap it.

Overnight aquaklear (2026-08-21): live ledger stuck at STARTING, watchdog never printed
child-exit — the wrapper was killed with the launching agent turn. nohup alone is not
enough when the parent is a Cursor sandbox shell that SIGKILLs its process group.

Usage (from app/):
  python3 scripts/dispatch-detach.py \\
    prompts/dispatch/aquaklear-ms-speed-cut.md \\
    /tmp/klaudius-speed-cut/aquaklear-ms-dispatch.log \\
    25 180 clients/aquaklear-ms
"""
from __future__ import annotations
import os, sys, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def main() -> int:
    if len(sys.argv) < 6:
        print(__doc__, file=sys.stderr)
        return 2
    prompt, log, stall, soft, watch = sys.argv[1:6]
    extra = sys.argv[6:]
    watchdog = Path(log).with_name(Path(log).stem.replace('-dispatch', '') + '-watchdog.log')
    if 'dispatch' not in Path(log).stem:
        watchdog = Path(str(log) + '.watchdog')
    # Prefer sibling *-watchdog.log convention used overnight
    if Path(log).name.endswith('-dispatch.log'):
        watchdog = Path(log).with_name(Path(log).name.replace('-dispatch.log', '-watchdog.log'))
    watchdog.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        'bash', str(ROOT / 'scripts' / 'dispatch-build.sh'),
        prompt, log, stall, soft, watch, *extra,
    ]
    # Fresh env without CLAUDECODE nesting; child sets CLAUDE_WORKER_CHILD itself.
    env = {k: v for k, v in os.environ.items() if k not in ('CLAUDECODE', 'CLAUDE_CODE')}
    with open(watchdog, 'a') as wf:
        wf.write(f'\n--- detach launch {__import__("datetime").datetime.utcnow().isoformat()}Z ---\\n')
        wf.flush()
        proc = subprocess.Popen(
            cmd,
            cwd=str(ROOT),
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=wf,
            stderr=subprocess.STDOUT,
            start_new_session=True,  # new process group — survives parent death
            close_fds=True,
        )
    print(f'detached pid={proc.pid} watchdog={watchdog}')
    print(f'  poll: kill -0 {proc.pid}; tail -f {watchdog}')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
