# Why last night’s design lift didn’t stick (and the fix)

## Cause
Lift landed on skills + the bluegrass **client**, not `templates/trade-site`. Max `cp -r`’d an unlifted scaffold.

## Fix (2026-08-21) — bluegrass 1:1 into template
`templates/trade-site` now ships:
- Full lift `globals.css` (hero-overlay, gauge-*, signature-spine, photo-ground, grain, heavy CTAs, palette utils)
- `layout.tsx` owning SiteNav + SiteFooter + Motion + SiteChat
- `SiteNav.tsx` / `SiteFooter.tsx` (dropdown + top strip + gauge divider)
- `site-data.ts` stub contract (`NAV_LINKS` children, hours fields)
- `tailwindcss-animate` wired in `tailwind.config.ts`

Opus fills tokens/fonts/data. Does not reinvent chrome.
