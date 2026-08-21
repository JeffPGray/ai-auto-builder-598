# Speed-cut A/B replay

Branch: `experiment/speed-cut`. Gather excluded.

## Baseline (do not rebuild to "beat" this by changing gates)

| slug | ended | wall | weighted tokens |
|---|---|---|---|
| hillards-septic-ms | 2026-08-21 | **150.4 min** | **1.63M** |
| diers-vacuum-service-ms | 2026-08-21 | 150.6 min | 2.06M |

Target: gathered → QA PASS **< 60 min**, tokens **not worse than 2.1M**, authoring **≤ 2 compactions**, **≤ 1 Write per `page.tsx`**.

## Replay client

`aquaklear-ms` — already gathered. Site reset in this worktree only (`reset-client-design.mjs --yes`). Live `*.grayreserve.agency` tenant is untouched.

```bash
cd /Users/jeffgray/Github/klaudius/.worktrees/klaudius-speed/app
python3 scripts/cost_ledger.py build-start aquaklear-ms
# In Claude Code on this worktree, with experiment/speed-cut checked out:
#   /build aquaklear-ms
# Then:
python3 scripts/cost_ledger.py build-end aquaklear-ms
node scripts/stage-timer.mjs show aquaklear-ms
node scripts/write-once-check.mjs aquaklear-ms
node scripts/verify-blog-spawn.mjs ~/.claude/projects/-Users-jeffgray-Github-klaudius--worktrees-klaudius-speed-app/<session>.jsonl
```

A full Opus authoring pass is **not** run from this instrumentation commit: it is a 60–150 minute Claude Code session. Instrumentation + idle cuts + skill split land first so the replay can attribute minutes to `copy-template` / `author` / `blogs` / `gates` / `qa-round-N` / `deploy`.

## If A–C cannot beat 90 minutes

Escalate to parameterized section primitives (plan D phase 2). Do not add more prose to `SKILL.md`.
