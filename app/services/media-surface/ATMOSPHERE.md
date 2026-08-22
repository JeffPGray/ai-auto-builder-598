# Atmosphere — BOTH lanes (shared + dedicated)

Gate: `scripts/verify-media-surface.mjs` · constants in `services/media-surface/contract.mjs`  
Authors: read this before painting any section. **Flat is craft.** Hatch is texture, not a plane.

```
PLANE → optional PLATE → optional TEXTURE → optional CHROME
```

One class per layer per section. Stacking *within* a layer is banned.

## Four layers

| Layer | Job | Canonical classes | Default |
|---|---|---|---|
| **Plane** | What the section is | `bg-surface-1/2/3`, `photo-ground` (+ wash + `lift-panel`) | Flat surface |
| **Plate** | Earned color / soft depth | `band-depth-frost`, `band-depth-dark`, `band-vs-split`, `band-panel`, `band-copper-plate`, `band-go-mesh` | At most one loud plate beat |
| **Texture** | Grain *on* a plane/plate | `hatch` / `--light` / `--cross`, `grain`, `paper-tooth`, `band-seam` | **None** |
| **Chrome** | Structure, not fill | `go-frame`, `signature-spine`, `watermark`, `cinema-grade--dealer`, `tick-rail`, `edge-rule`, `band-ledge` | Optional |

## Page budgets (hard)

| Token | Max / marketing page |
|---|---|
| `HATCH_SECTIONS_MAX` | **1** |
| `FROST_SECTIONS_MAX` (`band-depth-frost`) | **2** |
| `COPPER_SECTIONS_MAX` | **1** |
| `MESH_SECTIONS_MAX` (`band-go-mesh`) | **1** |
| `LOUD_BEATS_MAX` (frost ∪ copper ∪ hatch ∪ go-mesh sections) | **3** |
| Watermarks | ≤2 (quiet chrome) |

## Mutual exclusion (same `<section>`)

| Forbidden | Why |
|---|---|
| `hatch` + `grain` | Two textures |
| `hatch` + `band-go-mesh` | Accent on money chrome |
| `band-copper-plate` + `band-depth-frost` | Two plates |
| `hatch` on `data-hero` | Texture on photo plane |
| `band-go-mesh` on `/services/<slug>` | Money closer = home/contact only |

## Service detail — frost forever

`ServiceDetailFrame` only: **photo-ground hero + `band-depth-frost` body**.  
**Ban** `hatch*` and `band-go-mesh` on `/services/<slug>`. No rotation. Variation = photo + copy + spine. Authors must use the frame component (or identical class stack) — media-surface fails closed otherwise.

## Soft depth without stripes

| Class | When | Budget |
|---|---|---|
| `band-depth-frost` | Calm body depth | ≤2 |
| `band-vs-split` | Compare / before-after | ≤1 |
| `band-panel` / `band-depth-dark` | Mid ink without GO | ≤1 |
| `grad-frost` | Simple light wash | Counts as frost |
| `band-ledge` | Machined light plate when frost spent | ≤1 |
| `band-seam` | One soft diagonal (not repeating hatch) | ≤1; mutex with hatch |
| `paper-tooth` | Micro tooth on long light copy | ≤1; no hatch/grain |
| `edge-rule` | Hairline at section join | ≤2 |

## Hatch (accent only)

1. Default: **no hatch.**  
2. Prefer `hatch--cross` on `band-copper-plate` only.  
3. Never wallpaper light FAQ / form / reviews / consecutive surfaces.  
4. Never on service detail.

## Default home recipe

| # | Job | Treatment |
|---|---|---|
| 1 | Hero | `photo-ground` + overlay + optional `grain` |
| 2 | Measured | `band-copper-plate` + optional **one** `hatch--cross` |
| 3 | Services | flat `bg-surface-1` + spine |
| 4 | Process / contrast | frost **or** `band-vs-split` **or** flat |
| 5 | Proof (optional) | photo-ground + cinema + `lift-panel` |
| 6 | Closer | `band-go-mesh` + `go-frame` + optional `watermark--go` |

FAQ/forms: flat only.

## Wiring

| When | What |
|---|---|
| Preflight | `node scripts/inspect-logo.mjs $SLUG --write` |
| Author | This file + HARD RULE in `stages/author.md` |
| Verify | `MEDIA_SURFACE_CHECK` on TSX + built `out/` |
| QA | `ship-scan.mjs --fix` (comment / tell cleanup) |

Do not invent stripe utilities in client CSS — extend `templates/trade-site` globals + this doc.
