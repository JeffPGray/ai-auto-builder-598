---
name: build
description: Build a bespoke Next.js website from gathered content for a business
argument-hint: [business-name]
effort: high
allowed-tools: Bash(npx *), Bash(npm *), Bash(node *), Bash(python3 *), Bash(bash *), Bash(cd *), Bash(mkdir *), Bash(cp *), Bash(rm *), Bash(mv *), Bash(kill *), Bash(sleep *), Bash(grep *), Bash(cat *), Bash(test *), Bash(echo *), Bash(for *), Bash(wc *), Bash(sort *), Bash(uniq *), Bash(cut *), Bash(tee *), Bash(find *), Bash(wait *), Bash(*/notify.sh *), Bash(ls *), Bash(tr *), Bash(date *), Read, Write, Edit, Glob, Grep, Skill, Agent, Task
---

# Build Website for $ARGUMENTS

Create a bespoke Next.js site using ONLY `clients/$ARGUMENTS/data/gathered-content.md`.
Read `prompts/lessons/build.md` first.

**Do not re-read this file whole after compaction.** Load the current stage file only.

| Stage | File | Timer | Model |
|---|---|---|---|
| 1 preflight | `stages/preflight.md` | — | parent |
| 1b consult once | `stages/consult-once.md` | `design` | **one** `search.py`, then `design-lock.md` |
| 2 copy template + hero video | `stages/preflight.md` § Setup | `copy-template` | scripts |
| 3 design lock | `stages/design.md` | `design` | **Opus / high** |
| 4 chrome | `stages/design.md` | `author` (chrome only) | **Opus / high** |
| 5 routes | `stages/author.md` | `author` | **Sonnet**, write-once children |
| 6 blogs | `stages/author.md` § Blog | `blogs` | **Sonnet** subagent, required |
| 7 gates | `stages/verify.md` | `gates` | Node (`pre-qa-gates.sh`) |
| 8 QA | CLAUDE.md QA Loop | `qa-round-N` | Sonnet qa-reviewer, **after gates PASS** |

```bash
node scripts/stage-timer.mjs start $ARGUMENTS copy-template
# …cp template, npm cache, hero video…
node scripts/stage-timer.mjs end $ARGUMENTS copy-template
```

## Model routing (hard)

- **Opus / high:** design consult, `DESIGN_IDEA`, `globals.css`, `site-data.ts`, `SiteNav`,
  `layout.tsx`, `SiteFooter`, **and home `src/app/page.tsx`** (hero + services + one proof band +
  FAQ/CTA). That is the $5k bar surface — Sonnet must not invent a second identity on `/`.
- **Sonnet:** every other route `page.tsx`, the three blog articles, `qa-reviewer`.
- **Never Haiku.** Gates stay Node. Do not lower visual QA to Haiku.

**Surface atmosphere (BOTH lanes):** `services/media-surface/ATMOSPHERE.md` — hatch is accent ≤1/page;
default body is flat; `ServiceDetailFrame` = photo-ground + frost. Preflight runs `inspect-logo.mjs --write`.
Gate: `MEDIA_SURFACE_CHECK` (+ `ship-scan` at QA for comment/tell cleanup).

**Chrome owns home.** After design lock, Opus Writes `/` once. Sonnet children do not rewrite
`src/app/page.tsx`. Use template `FaqAccordion` + `EstimateDialog` + `ContactForm`; do not hand-roll
FAQ/details, estimate modals, or native form fields. Hero split: H1 `max-w-2xl|3xl`, pad ~24–32%.

If you draft `blog-data.ts` yourself, you have violated this file. Spawn:

```
Agent(subagent_type="general-purpose", model="sonnet", prompt="…POSTS array…")
```

in the **same message** as chrome work. Record `blogs` on the stage timer around that spawn.

## Write-once + route batches

After design lock, spawn one Sonnet child per route (or 2–3 related routes). Each child Writes **one** `page.tsx`, runs `node scripts/write-once-check.mjs $ARGUMENTS --note src/app/{route}/page.tsx`, and exits. Parent does not Read those files.

Do **not** template `SiteNav`, `SiteFooter`, `layout.tsx`, or the blog renderer.
Copy-template is scaffold only. Every look is unique to `$ARGUMENTS` (consult + lock + ledger).
Do not copy another client's chrome or routes. Do not ship a shared section kit.

**Do not rewrite** `HeroVideo.tsx`, `Motion.tsx`, `SiteChat.tsx`, `schema.ts` unless a gate names them.
Legal `/privacy` and `/terms` use the frozen layout in `reference/legal-pages.md`.

**No mid-build screenshot loop.** Do not `preview-route` / Read PNGs before `PRE_QA_GATES=PASS`.

Consult once: `stages/consult-once.md`. If `design-lock.md` exists, do not Skill-dump design corpora.

## Gates before screenshots

```bash
cd clients/$ARGUMENTS/site && npx next build
cd - >/dev/null
bash scripts/pre-qa-gates.sh $ARGUMENTS
```

`PRE_QA_GATES=FAIL` → fix, rebuild, re-run. **Do not spawn qa-reviewer.** Hillards round 1 burned a full screenshot pass on a contrast FAIL.

Then follow CLAUDE.md QA Loop (experiment cap: **2 rounds**. Round 2 is scoped unless the report tagged SYSTEMIC).

## After compaction

`Read` only `stages/{current}.md` with offset/limit for the heading you need. Never this SKILL.md whole, never a `page.tsx` you already wrote.

## Worker children

If `CLAUDE_WORKER_CHILD=1`, you are a build worker. Do not read `.claude/ledger.json`. Do not run `build-status.sh`. Do the client in the prompt and exit.
