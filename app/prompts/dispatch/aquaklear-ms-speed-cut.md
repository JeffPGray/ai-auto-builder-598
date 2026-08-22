Build AquaKlear (slug `aquaklear-ms`) on experiment/speed-cut — metered A/B vs hillards-septic-ms.

## Mode

**REUSE gather — do NOT re-run `/gather`.** Read `clients/aquaklear-ms/data/gathered-content.md` and trust it.
Site may have been reset — copy-template fresh if `clients/aquaklear-ms/site` is missing.

## Experiment: experiment/speed-cut (scorecard MUST hold)

Obey current skills (not memory of older builds):

1. `stages/consult-once.md` — ONE `search.py`, `design-lock.md`, `node scripts/sync-design-lock.mjs aquaklear-ms`. No Skill-dump.
2. Unique BETWEEN sites / coherent INSIDE. Signature = architecture (rail|index|mask|spine), not divider-only.
3. **Hero copy width:** H1 `max-w-2xl|3xl`; pad ~24–32%. Never skinny `max-w-xl` + `pr-[≥40%]`.
4. **shadcn:** core 4 required (accordion/dialog/sheet/dropdown-menu). Keep template `FaqAccordion`, `EstimateDialog`, `ContactForm` (mechanics pack fields). Do NOT import all 16 just to import them. No card/button/badge section kits.
5. **Remotion:** hero video in copy-template; wire `<HeroVideo src="/hero.mp4" …>`. Poster-only only with `HERO_VIDEO=FAIL`.
6. **Blogs:** exactly **3** articles (Sonnet spawn). Not five.
7. **Meter every stage:** `node scripts/stage-timer.mjs start aquaklear-ms <stage>` / `… end aquaklear-ms <stage>` around consult, chrome, routes, blogs, gates, qa-round-1, qa-round-2. Sonnet write-once routes. Opus = chrome + home `/`.
8. `pre-qa-gates.sh` BEFORE screenshots. Max **2** QA rounds.
9. Favicon + OG: `generate-favicon.mjs` + `generate-og-image.mjs`; wire layout openGraph/twitter.

Pipeline: consult-once → design lock + chrome (incl. home) → Sonnet routes → 3 blogs → next build → pre-qa-gates → QA (≤2) → **STOP**.

## HARD STOP — no deploy

⛔ **Do NOT deploy.** Do NOT run `/deploy`. Do NOT touch GHL, outreach, or `*.grayreserve.agency`.

When QA passes (or after 2 rounds), write verdict into `clients/aquaklear-ms/data/status.md` (DESIGN_IDEA, HERO_VIDEO, QA rounds, compaction count, **paste `node scripts/stage-timer.mjs show aquaklear-ms`**) and exit. Wall + weighted tokens land via dispatch `cost_ledger` build-end — do not invent numbers.

cwd: this app directory. Client: `clients/aquaklear-ms`.
