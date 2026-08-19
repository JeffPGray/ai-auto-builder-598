Client: cold-front-ac (slug) — Cold Front A/C Of The Woodlands. This is a RESUME of a dispatch that hung and was killed by the watchdog after fully completing gather, design system, and build+static-export — do not redo any of that finished work, verify it's intact and continue from QA onward.

## Already done — verify, do not redo
- `clients/cold-front-ac/data/gathered-content.md` — real content already captured (compete mode, existing site https://www.coldfrontacofthewoodlands.com works, pitch on what $598+$98/mo adds).
- `clients/cold-front-ac/data/design-system.md` — palette/typography/layout already chosen.
- `clients/cold-front-ac/site/` — full Next.js site already built: homepage, services index, 4 service pages (ac-repair, heating-services, hvac-maintenance, indoor-air-quality), about, contact, terms, privacy, blog + 5 articles, sitemap.
- `clients/cold-front-ac/site/out/` — static export already completed successfully (155 files, verified present).

Quickly confirm these are all still intact (`ls clients/cold-front-ac/site/out/*.html`) and read `clients/cold-front-ac/data/status.md` for the full build record. If anything looks genuinely missing or broken, fix only that — do not regenerate content that's already there.

## What actually needs to happen now

1. **QA** — spawn the `qa-reviewer` agent per CLAUDE.md's QA Loop (fresh eyes, zero build context). **CRITICAL: read `.claude/agents/qa-reviewer.md` Step 3's explicit warning about Call 2 (the local preview server) — it MUST run as a Bash tool call with `run_in_background: true`, NEVER with a shell `&`.** A `&`-backgrounded command under this pipeline's permission mode escalates to an approval prompt that nothing can answer in a headless run, and the entire pipeline hangs forever with zero CPU and zero further file writes — this is almost certainly what killed the previous attempt at this exact stage. Double-check every Bash call you or the QA agent makes for a stray `&` before running it. If QA reports a FAIL on any of the 6 HARD-BLOCKER items, fix and re-run QA (again watching for the `&` trap in every subsequent QA round too).

2. **`/deploy cold-front-ac`** — deploy to the shared PROSPECT lane (`{slug}.grayreserve.agency`) per the deploy skill's PROSPECT/CONVERTED table. This is a spec build, not a converted client — do NOT create a new dedicated Vercel project. Confirm the live URL serves 200 and spot-check the actual rendered homepage + one service page.

3. **GHL tagging** — `/deploy`'s own mirror tags the contact `demo-built`. `.env` has `OUTBOUND_SENDER=ghl` and `OUTREACH_ENABLED=true`, so do NOT run `/outreach` yourself — the published "GR-598 Demo-First Send" workflow owns the first-touch send once the tag lands. This is a real, live send to coldfrontacofthewoodlands@gmail.com.

## After — write the proof

Update `clients/cold-front-ac/data/status.md` with: QA pass/fail on each of the 6 HARD-BLOCKER items and round count, deploy live URL + route-check + curl 200, GHL contact ID + demo-built tag confirmation, and — if you can query the conversation/message log for that contact — confirmation the GR-598 workflow actually sent the email. Be honest about anything that didn't fully complete. Total wall-clock and approx token count for THIS resume run (not the prior killed attempt).
