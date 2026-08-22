## KLAUDIUS MEDIA + SURFACE RULES v2

Executable:
- Policy: `services/media-surface/contract.mjs`
- Gate: `node scripts/verify-media-surface.mjs <slug>`
- Image plan: `services/higgsfield/image-plan.mjs` + `clients/<slug>/data/image-plan.json`
- Template CSS: `templates/trade-site/src/app/globals.css`
- Template host: `templates/trade-site/next.config.mjs` (`assetPrefix`)

### Serving + run modes (same per-slug artifact)

| Mode | How | Contract |
|---|---|---|
| **Single site** | `/build {slug}` | Full preflight → image-plan → hero → author → gates |
| **Parallel lanes** | Find N → `run-lane` / `dispatch-build` per `clients/<slug>` | Same — slug-scoped only |

| Serving | Host | Asset base | `SITE_URL` |
|---|---|---|---|
| **Shared / multisite** (prospect) | `gr-no-website-builds` → `{slug}.grayreserve.agency` | `/klaudius/{slug}` | `https://{slug}.grayreserve.agency` |
| **Dedicated / single** (converted) | Own Vercel project | `KLAUDIUS_ASSET_PREFIX=''` | Real domain (`/seo`) |

Media + surface rules are identical in every cell. Parallel safety = only touch `clients/<slug>/…`.

---

### 1. Slot taxonomy → source

| Slot role | Allowed `source` | Notes |
|---|---|---|
| `hero-video` | `hf-hero` | Seedance **ref** when cleared photos exist (`mode: ref` + `--image` from `data/images/`); t2v only with zero stills; Remotion loud fallback |
| `service-loop` | `hf-loop` | 4s 720p ref micro-loop → `public/videos/{stem}.mp4` (optional slots) |
| `about-video` | `hf-loop` | About-page founder/team motion plate (optional) |
| `photo-ground` | `cleared` \| `hf-still` | Portrait in landscape → HF 16:9 plate |
| `product-feature` | `cleared` | Contained / cutaway |
| `thin-shelf` / `atmosphere-ground` | `hf-still` optional | Never under dense copy |
| `metrics` / `dense-copy` / `faq` / `spec-ledger` | **`none` only** | Photo-veil banned |

Never silent Pexels/stock. KEEP lines = `verify-photos.mjs` audit surface.
Generic slugs: `image-plan --pick` derives slots from cleared KEEP stems. Aqua keeps the rich preset.

---

### 2. Surface treatments (CSS — all modes)

| Class | Job | Hard rule |
|---|---|---|
| `.hero-overlay--split` | Route hero | Soft left wash; no hard top under nav; opacity **&lt; 0.85** (incl. color-mix %) |
| `.lift-panel--ink` | Opaque copy on photo-ground | No heavy left cinema veil underneath |
| `.cinema-grade--dealer` | Letterbox blend only | Subject in right ~55%+ |
| `.band-go-mesh` + `.go-frame` + `.lift-panel--ink` | Money CTA (≤1 earned closer/page) | Never bare `bg-surface-6`; never decorative spam |
| `.cta-primary` | Primary CTA | Solid brand fill + chromatic shadow (template) |
| `.cta-primary--on-ink` | CTA on ink | Bright label |
| `.band-depth-frost` / `.band-depth-dark` / `.band-vs-split` / `.band-panel` / `.grad-frost` | Soft depth / ink plates | frost ≤2; see ATMOSPHERE.md |
| `.band-copper-plate` / mesh plates | Earned colored plate | ≤1 copper/page |
| `.band-ledge` / `.band-seam` / `.paper-tooth` / `.edge-rule` | Hatch alternatives (no wallpaper) | ≤1 each where noted |
| **`.hatch`** | **Accent texture only** | **≤1 hatched section/page**; **banned on service detail** |
| `.watermark` | Quiet glyph | ≤2/page |
| `.signature-spine__rail--h` | SPINE rail | Cap width — no copper bleed |

Full menu + home recipe: **`services/media-surface/ATMOSPHERE.md`** (plane → plate → texture → chrome).

**Per-service pages:** use `ServiceDetailFrame` (photo-ground + **`band-depth-frost` forever**). Ban hatch and go-mesh. Gate fails flat `grad-*` + white body.

Nav clearance: `[data-hero]` uses **`pt-40`** (full-bleed home may use `100svh` + content pad).

---

### 3. Lane-specific host only

**Shared:** default `assetPrefix`; `SITE_URL=https://{slug}.grayreserve.agency`; `noindex`; publish via tenant publisher.  
**Dedicated:** rebuild with `KLAUDIUS_ASSET_PREFIX=''`; `/seo` sets domain + indexing.

---

### 4. Score floors

Slot ≥ **7/10**; hero ≥ **8/10** (motion weighted).

### 5. Pipeline

```bash
node services/higgsfield/image-plan.mjs --slug $SLUG --all
node services/higgsfield/hero-prompt.mjs --slug $SLUG
node services/higgsfield/render-hero.mjs --slug $SLUG
node services/higgsfield/render-loops.mjs --slug $SLUG
node scripts/verify-photos.mjs $SLUG
node scripts/verify-media-surface.mjs $SLUG   # fail-closed if plan missing
```
