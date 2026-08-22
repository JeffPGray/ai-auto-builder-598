# Speed-cut overnight — morning brief (2026-08-21)

## What ran overnight
- **Aquaklear Max stack proof** (no deploy): `dispatch-build.sh` + ledger `build-start aquaklear-ms`
- Prompt: `prompts/dispatch/aquaklear-ms-speed-cut.md`
- Logs: `/tmp/klaudius-speed-cut/aquaklear-ms-dispatch.log` + `aquaklear-ms-watchdog.log`

## When you wake — verify
```bash
cd /Users/jeffgray/Github/klaudius/.worktrees/klaudius-speed/app
tail -80 /tmp/klaudius-speed-cut/aquaklear-ms-watchdog.log
tail -40 /tmp/klaudius-speed-cut/aquaklear-ms-dispatch.log
python3 scripts/cost_ledger.py build-end aquaklear-ms   # if dispatch exited clean
python3 scripts/cost_ledger.py compare aquaklear-ms --baseline hillards-septic-ms
node scripts/stage-timer.mjs show aquaklear-ms
node scripts/richness-check.mjs clients/aquaklear-ms/site
```

Target: wall <60m, tokens ≤~2.1M, richness PASS, QA ≤2, **no** grayreserve.agency.

## Stack already landed (Cursor, experiment branch only)
- Consult-once + $5k bar + chrome-owns-home + blogs 3
- Signature architecture gate + hero-width gate + WebP/weight fail-closed
- Favicon + OG scripts; Remotion src fail-closed when mp4 exists
- shadcn 16-pack vendored; **core 4** required imports; ContactForm uses pack
- Subpage DESIGN_IDEA `[binding]` already fail-closed
- Bluegrass local fixture: richness PASS, preview :4317 (not a live deploy)

## Still not automatable (grade lifts left)
- Signature *invention* quality (Opus taste per client)
- Remotion wallet/keys reliability in CI (infra)
- Proven aquaklear vs hillards numbers (this overnight run)

## Do NOT
- Merge to main until aquaklear compare looks good
- Redeploy live tenants from this experiment
