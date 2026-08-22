# Consult once (experiment/speed-cut)

gulf-coast-septic-ms sat in `/impeccable` for ~90 minutes with 9 compactions and never deployed.
Re-invoking `ui-ux-pro-max` + `impeccable` + `anti-ai-slop` as full Skill dumps is a quality bug
(the brief gets summarized away) and a token bug (the corpus is larger than the site).

**Unique designs, not templates.** `templates/trade-site` is a Next.js scaffold (routing, chat,
hero video, legal). It is not the look. Do not copy another client's `SiteNav`, `globals.css`,
or `page.tsx`. Do not invent a shared section kit. Uniqueness is **between sites**. Coherence is
**inside one site**.

## Do this once, then never again this build

```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py \
  "<industry> <style keywords from THIS gathered-content.md>" \
  --design-system -p "$ARGUMENTS" \
  | tee "clients/$ARGUMENTS/data/design-system.md"
```

Query from **this** business's photos, materials, town, and personality. A pressure-washer with a
retail shop is not the same consult as a septic pumper.

Write `clients/$ARGUMENTS/data/design-lock.md` in the same turn. Eight lines, no more:

```
DESIGN_IDEA: <one sentence ONLY this business can own — visitor could name it>
GROUND: NEUTRAL-CANVAS | FULL-TINT
HEADING / BODY: <consult pairing, unless banned or same-town collision>
ACCENT: <hex from derive-palette>
SIGNATURE MOVE: <compositional rule invented for THIS gather — not an example from this file>
CANVAS: <what sits behind the hero, from their photos/materials>
DO NOT: default UI stacks, purple/LILA, copying last client's hero
```

Then:

```bash
node scripts/sync-design-lock.mjs $ARGUMENTS
node scripts/derive-palette.mjs   # stages/design.md Step 3
node scripts/design-ledger.mjs check $ARGUMENTS --ground … --ground-hue … --formula …
```

`sync-design-lock.mjs` fails if this SIGNATURE MOVE is too close to a prior client's lock.
`design-ledger.mjs` fails twins on ground + type register. Both must be CLEAR before TSX.

## Forbidden after the lock exists

- `Skill(skill="impeccable")` as a long session. Composition is the SIGNATURE MOVE line.
- A second `search.py --design-system`.
- `Skill(skill="anti-ai-slop")` as a full dump. Checklist: no em dashes; no elevate/leverage/unlock;
  no invented facts; no fake author byline.
- Re-reading `design-system.md` whole after chrome is written. Use `design-lock.md`.
- Copying chrome or routes from `clients/<other-slug>/`.
- A parameterized "hero / cards / CTA" page kit shared across clients.

## Design lift — $5,000+ agency bar (quality AND uniqueness)

Opus authors **this client's** `globals.css`, `layout.tsx`, `SiteNav`, `SiteFooter`, `site-data.ts`
from **this** lock. Sonnet routes execute **this** SIGNATURE MOVE — they do not invent a second
identity on `/about`. That is not a template. That is one bespoke building, many rooms.

If two Klaudius sites could swap CSS and still look "right," the lock failed uniqueness.

**Bar (must clear before QA PASS).** This is what "$5k design" means here — not adjectives:

1. **Brand-first viewport** — remove the nav and a stranger still names THIS business (wordmark or
   lock canvas in the hero, not a generic headline alone).
2. **Lock canvas is the hero** — `CANVAS:` asset is the LCP/poster plane. Before/after and stock
   live below the fold.
3. **Asymmetric composition** — no centered hero stack (eyebrow + H1 + paragraph + dual CTAs).
   **Template ships the bluegrass 1:1 lift** (`layout` chrome + `SiteNav`/`SiteFooter` + full `globals.css`: hero-overlay/--split, gauge-*, signature-spine/index, photo-ground, grain, heavy CTAs). Bind signature moves to gauge-rail **or** signature-spine; do not invent a third thin divider system. Also: **Template ships the lift CSS** (`hero-overlay`, `hero-overlay--split`, `signature-spine` / `signature-index` / `signature-spine__rail`, `photo-ground`) in `templates/trade-site` globals — bind those class names; do not reinvent skinny heroes. Skills alone do not stick; the scaffold does.

   **Hero copy width (split heroes):** H1 uses `max-w-2xl` or `max-w-3xl` (never `max-w-xl` on the
   H1). Media-side pad stays ~`md:pr-[24%]`–`[32%]` — never `pr-[≥40%]` with a skinny type column.
   `richness-check` FAILs the narrow pattern.
4. **No service card kit** — three equal `rounded-xl` image+copy cards fail. Use editorial bands,
   split rails, or signature-driven lists.
5. **Signature is structure** — `SIGNATURE MOVE:` names a role (`rail | index | mask | spine`),
   not a glyph. Motif appears in ≥3 roles with ≥1 non-divider (rail/index/mask/spine). Divider-only
   fails richness.
6. **Atmosphere** — ≥2 photo-grounded sections (wash + grain). Flat fills alone fail richness.
7. **Restraint** — one accent, tinted neutrals, OKLCH gradients where used. No LILA, no Inter.
8. **Heavy CTAs** — use template `.cta-primary` / `.cta-secondary` / `.cta-secondary-ink` (bold,
   min-height 52px). Do not invent light outline pills.
9. **shadcn core 4/4 + forms** — accordion + dialog + sheet + dropdown-menu required. ContactForm
   uses the mechanics pack (`ui/input|label|textarea|select|checkbox`), not hand-rolled natives.
   Extra pack pieces (tabs/tooltip/…) are available; card/button/badge stay banned for sections.

**Opus writes `/` (home).** Sonnet does not rewrite `src/app/page.tsx`. That single rule cuts the
token burn from composition rediscovery more than any Skill dump.
