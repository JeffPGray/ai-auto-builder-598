# Morning brief — experiment/speed-cut (2026-08-21)

## Overnight aquaklear

```bash
cd ~/Github/klaudius/.worktrees/klaudius-speed/app
tail -40 /tmp/klaudius-speed-cut/aquaklear-ms-watchdog.log
python3 scripts/cost_ledger.py show aquaklear-ms
python3 scripts/cost_ledger.py compare aquaklear-ms --baseline hillards-septic-ms
node scripts/stage-timer.mjs show aquaklear-ms
node scripts/richness-check.mjs clients/aquaklear-ms/site
cat clients/aquaklear-ms/data/status.md
```

**Pass bar:** wall &lt; ~60–70m, weighted tokens ≲2.1M vs hillards, richness PASS, QA ≤2, **no** `*.grayreserve.agency` deploy.

Logs: `/tmp/klaudius-speed-cut/aquaklear-ms-{dispatch,watchdog}.log`

---

## If green → merge the stack

Speed-cut owns skills/gates (consult-once, CORE-4, hero-width, Remotion fail-closed, 3 blogs, etc.).

**Parallel 3-lane** lives on main Klaudius and was patched tonight:

| Piece | Where |
|---|---|
| `run-lane.sh` + `supervise-campaign.sh` | main + synced into speed-cut |
| `dispatch-build.sh` | **both** — DONE-grace, live ledger, stream-json, **artifact-exclude** (`site/out`/`.next`), ceiling→grace when transcript COMPLETED, require `clients/<slug>` arg 5 |
| Skills/gates from this experiment | speed-cut only until merge |

Merge direction: bring speed-cut skill/gate/template changes onto `main`, keep the patched dispatcher (already on both).

---

## Kill bugs fixed tonight (both trees)

1. Soft ceiling extended forever on `out/` writes after the model finished → exclude artefacts from liveness find.
2. Soft ceiling ignored COMPLETED teardown → on ceiling, if transcript COMPLETED → 120s grace then reap (same path as idle-COMPLETED).
3. Hand-launch with bare `clients` skipped `cost_ledger` → now **exit 2**.
4. Speed-cut was missing main’s DONE-grace / run-lane / summarize-dispatch-log → **synced from main**.
