# Design reset — decision note (2026-08-19)

## ⭐ THE ROOT CAUSE — found by measuring the real transcript, supersedes everything below

**The build compacted 9 times. First at minute 12, then every ~14 minutes.**
`06:06 start → compactions at minute 12, 17, 24, 37, 45, 51, 59, 119, 127.`

Where the 130 minutes actually went (measured from timestamp gaps in the real transcript):

| Bucket | Time | % |
|---|---|---|
| Model thinking after tool results | 53.0 min | 40.7% |
| Queued-prompt / compaction handling | 48.5 min | 37.2% |
| Assistant-to-next-step | 14.1 min | 10.8% |
| Sub-agents | 10.3 min | 7.9% |
| **ALL Bash (every script, gate, build, screenshot)** | **3.7 min** | **2.8%** |

**Tool execution is 2.8% of the build.** The gates, screenshots, contrast checks and image
optimisation are NOT the time cost. The cost is the model thinking on a context so heavy it
compacts every 14 minutes.

### The sharper mechanism — measured after the reset

**56 of the build's 76 `Read` calls were RE-READS of files it had authored itself.**
`page.tsx` re-read **21x** (and written 34x), `site-data.ts` 7x, `globals.css` 5x, `schema.ts` 5x.
A route `page.tsx` is 6-10K tokens, so ~21 whole-file re-reads is on the order of the entire 200K
context window, spent reloading code this build already wrote.

This explains the 9 compactions better than skill-file size does, and it is a *spiral*:
context fills → compaction → the model no longer holds the code it authored → it re-reads the whole
file to make one edit → context re-inflates → it compacts again.

Fixed by four priority-ordered context rules in `build/SKILL.md` (write each page once and
complete; never whole-file re-read your own output — use `offset`/`limit`; re-orient after
compaction via `verify-design-intent.mjs --brief-only` (~8 lines) and a `find`, not by re-reading
generated code; batch edits so one read serves many).

⚠️ **This makes the every-service-a-page risk concrete:** more routes = more `page.tsx` = more
re-read surface. The context rules must hold before route count goes up.

### This single fact explains BOTH symptoms at once

1. **Why time doubled while tokens fell.** Cache reads are weighted ×0.1 so a bloated context looks
   cheap in tokens — but the model still has to *attend to all of it every turn*, and attention is
   wall-clock. Compaction adds more: summarise everything, then re-read files to recover
   (76 Read calls in this build). Tokens went down; time did not. Exactly what Jeff observed.
2. **Why the design regressed.** DESIGN_IDEA, the trade-identity brief, signature moves and the
   composition rules were all established in the first ~12 minutes — **then compacted away.** Every
   page written after minute 12 was authored from a *summary* of the design intent, not the intent.
   By minute 59 it had compacted seven times. The services page — the one that reads like slop —
   was written deep in that degraded state.

**The build was cliff-notes reading its own design brief.** Same failure Jeff called out in me.

### Correction to my earlier answer

I argued "deleting all design guidance only saves 7.5% of weighted tokens, so it's not the win."
That measured the wrong axis. The design guidance's real cost is not its token weight — it is that
it makes the context heavy enough to force compaction, and compaction destroys both the schedule
and the design fidelity. **Jeff's instinct was right; my analysis was wrong.**

### What this makes the fix

Not "fewer rules to save tokens." The target is: **design guidance small enough that a build holds
its own design intent end-to-end without compacting.** Hard measurable rules are the way there
because a rule table + a script is a fraction of the size of incident-narrative prose — the size
win and the quality win are the same move.

Two supporting fixes, both cheap:
- **Re-read the brief after every compaction.** `status.md` already holds DESIGN_IDEA + signature
  moves and is small. A build must re-read it after each compaction boundary, not narrowly re-read
  generated code.
- **Cut turns.** 486 assistant messages / 296 tool calls. Fewer, larger batched steps = fewer
  compaction boundaries.

⚠️ **Risk to flag: "every service gets a page" (changed today) increases route count, which
increases context and turns — it will make compaction WORSE unless the context problem is fixed
first.** Fix the context, then add the pages.

---


Jeff's proposal, in his words: keep every infrastructure lift (chatbot, AI visibility, SEO,
blogging, multi-page, nav dropdowns, CMS-on-purchase), **reset the design skill to stock**, then
re-elevate it with hardened rules to his actual expectation.

## The measured facts (verified, not recalled)

| Build | Weighted tokens | Wall clock | QA rounds | Jeff's rating |
|---|---|---|---|---|
| demolition-okc | 6.08M | 44.0 min | 2 | **2/10** |
| sunchaser-blinds | 7.29M | 77.6 min | ? | — |
| powerwash-ington | 8.26M | 39.6 min | ? | — |
| **cold-front-ac (elevated)** | **8.00M** | **127.5 min** | **3 + resume** | flat/bad |

Ledger weighting: `input + output + cache_write + (cache_read × 0.1)` — cache reads are weighted
down because the subscription bills them far below fresh tokens.

**Token cost of the design guidance, computed:**
- `build/SKILL.md` = 203KB ≈ 50,759 tokens
- replayed across 309 turns = 15.7M raw cache-read tokens = **1.57M weighted = 19.6% of the build**
- design-specific sections = 987 of 2,579 lines = **38% of that file**
- ⇒ **deleting ALL design guidance saves ~7.5% of total weighted tokens**

## What this proves and disproves

1. **Tokens are FLAT, not up.** 8.00M tonight vs 8.26M on powerwash-ington. The design lift did
   not blow up token cost. What tripled was **wall clock** (39.6 → 127.5 min).
2. **Time went to QA rounds, not design prose.** 3 rounds + a resumed dispatch. Each round =
   full screenshot capture + gate battery + model review.
3. **The FAST builds are the BAD builds.** demolition-okc: 44 min, 6.08M tokens, rated **2/10**,
   with the recorded diagnosis *"every skill ran; the build used about a quarter of what it was
   handed."* Reverting design guidance returns to exactly that state — the state whose defining
   failure was flatness.
4. **7.5% is not the win.** Cutting QA from 3 rounds to 1 saves ~2/3 of the wall clock. Cutting
   all design guidance saves 7.5% of tokens and the entire design capability.

## The actual root cause (why a rewrite-from-stock would fail the same way)

**Every design rule verifies PRESENCE, not INTENSITY.**

- "One dominant scale contrast per page" → satisfied by a heading 1.2x body size
- "Use a signature motif" → satisfied by one faint divider line
- "Make one card dominant" → satisfied by one extra CSS class
- "4+ gradients" → satisfied by four invisible 2%-opacity gradients

A model satisfies a soft rule with the minimum that technically qualifies. Deleting soft rules and
writing new soft rules from a clean slate **reproduces the identical failure**, having paid the
cost of losing every incident lesson encoded in the current file.

⚠️ **This applies to my own fix from this morning too.** The "visual boldness" gate I added to
`qa-reviewer.md` (commit ce55a4d) is a *reviewer instruction* — model-judged, soft, untested. By
this analysis it is the wrong SHAPE. It should be a script that measures.

## Recommendation: rewrite in place, hard rules — do NOT revert to stock

| | Revert to stock → re-elevate | Rewrite design sections in place |
|---|---|---|
| Token saving | ~7.5% | ~7.5% (same — cut the same prose) |
| Incident knowledge | **lost** (2026-08-16 flatness, contrast bugs, photo gate) | kept, converted to constraints |
| Steps | 2 (revert, then rebuild) | 1 |
| Risk | reintroduces known-fixed failures | contradictions surface during rewrite |
| Ships | after two passes | today |

**The conversion that matters — soft → measurable:**

| Soft (today) | Hard (target) |
|---|---|
| "one dominant scale contrast" | largest heading ≥3.5× body px, script-measured, FAIL under |
| "break the grid once" | ≥1 element with span/offset/translate differing from siblings, counted |
| "use a signature motif" | named motif appears ≥3× in built HTML, ≥N SVG nodes or ≥Xpx |
| "make one card dominant" | dominant element ≥1.5× a sibling's rendered area, pixel-measured |
| "4+ gradients" | ≥4 gradients each with ≥15% perceptual delta between stops |

Hard rules are cheaper *and* stricter: a script replaces paragraphs of prose (token win) and
cannot be satisfied by a token gesture (quality win). That is the same win as the revert, without
losing anything.

## What Jeff is right about (concede plainly)

1. The design section is the least-proven part of the system — it has never produced a site he
   rated well. That track record is real.
2. `build/SKILL.md` grew by accretion to 203KB, much of it incident-narrative prose
   ("caught live 2026-08-16…"). Fable flagged ~15–20K tokens of history that belongs in git.
3. Contradictions accumulate — 3 found and fixed on 2026-08-19 alone.
4. A clean-slate rewrite **is** genuinely different from patching — but only if the new rules are
   measurable. That condition is the whole decision.

## Not in dispute — keep as-is

chatbot (SiteChat) · AEO/AI-visibility · SEO skill · blog (5 articles) · multi-page standard ·
every-service-gets-a-page (changed 2026-08-19 per Jeff) · nav dropdowns · CMS-on-purchase ·
resumable dispatch · retrieval fix · identical-sibling detector · HyperUI stays deleted.
