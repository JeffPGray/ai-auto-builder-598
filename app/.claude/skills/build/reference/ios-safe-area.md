<!--
Split out of build/SKILL.md 2026-08-16 (Fable token-cost review — this file split, and the
deploy/SKILL.md host split earlier tonight, follow the same rule: only the WHY/HOW exposition
moves, every hard requirement stays verbatim in the core). This is the full story behind the
three requirements build/SKILL.md's condensed "§ iOS safe-area, one-line requirements" box
states — read it if you need the reasoning, the failure history, or you're touching any of this
code and want the full context. The core box has everything you need to just DO it correctly;
this file is for understanding WHY those exact lines are what they are.
-->

## ⚠️ `env(safe-area-inset-*)` IS ZERO IN PORTRAIT SAFARI — read this before using it

This single fact caused three separate bugs on one build, and each one looked like something else:

1. **Navbar** — `padding-top: env(safe-area-inset-top)` on a fixed nav was a NO-OP, so the strip
   above it showed page content. Two attempts were spent on `theme-color` instead.
2. **Chat panel** — an `inset-0` full-screen mobile sheet padded with the same env() put its 66px
   header BEHIND the status bar. On a real iPhone the panel opened to blank space with no header and
   no greeting, while the identical markup rendered perfectly at 375x812 in a desktop browser.
3. Any future full-bleed mobile overlay will do the same.

The insets are only non-zero in **landscape, standalone/PWA, and fullscreen**. In normal portrait
browsing Safari's chrome occupies that region and the layout viewport starts below it —
`viewport-fit=cover` does not change this.

**So never use a bare `env()` for clearance. Always floor it:**

```css
padding-top: max(env(safe-area-inset-top, 0px), 48px);
```

And remember a desktop browser at 375x812 **cannot reproduce any of this** — it has no browser
chrome overlaying the viewport. These are device-only bugs; verify on a handset or not at all.

## The iPhone "hollow notch" — `html` background, NOT theme-color (settled 2026-08-16)

⚠️ **`env(safe-area-inset-top)` is ZERO in portrait Safari.** The safe-area insets are only non-zero
in landscape, in standalone/PWA mode, and in fullscreen. In normal portrait browsing Safari's own
chrome occupies that region and the layout viewport starts BELOW it — `viewport-fit=cover` does not
change this. So padding a fixed nav with `env(safe-area-inset-top)` is a **no-op on the exact device
showing the bug**, which is why two earlier attempts at this failed.

**What actually paints that strip is the ROOT element's background.** With no `html` background it
falls through to `body`, which on these sites is cream — hence a light band above a dark navbar, and
page content visibly bleeding through during the URL-bar collapse animation.

**Both parts are required:**

```css
/* globals.css — the load-bearing half */
html { background-color: <the nav's surface colour>; }   /* body stays light */
```

```tsx
/* the fixed nav projects upward, so the strip revealed mid-collapse is nav, not content */
className="fixed top-0 left-0 right-0 z-50 bg-surface-dark
           before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full
           before:h-[100px] before:bg-surface-dark before:content-['']"
```

`body` keeps its light background — only the canvas outside the body box goes dark, which also makes
both rubber-band overscroll zones match (top = nav, bottom = footer, since footers here are dark).

**`theme-color` does NOT fix this and never did.** On iOS it tints Safari's own chrome surfaces in
some states; the moment the user scrolls, that bar becomes a translucent blur over live page pixels
and no meta tag reaches the strip. Keep it (it darkens the expanded chrome) but never treat it as
the fix. Its real power is standalone PWA mode, which these sites are not.

## `theme-color` in every `layout.tsx` (keep it, but see above)

```tsx
export const viewport = {
  viewportFit: "cover",    // REQUIRED — see below
  themeColor: "#261f1a",   // the NAV's surface colour, as a literal hex
};
```

And the fixed nav must pad itself into the inset:

```tsx
<nav style={{ paddingTop: "env(safe-area-inset-top, 0px)" }} className="fixed top-0 ...">
```

⚠️ **`theme-color` ALONE DOES NOT FIX THE WHITE BAND, and this cost two attempts.** Without
`viewport-fit=cover` the page never extends under the status bar, `env(safe-area-inset-top)` stays
**0**, and a `fixed top-0` nav therefore starts BELOW the inset — iOS fills that strip itself. The
meta can be present and correct (verified in the served HTML) while the handset still shows white.
You need all three: `viewportFit: "cover"`, `themeColor`, and safe-area padding on the nav.

iOS paints the area around its own browser chrome — the strip above a `fixed` navbar, plus the
overscroll gutters — from `theme-color`, **not** from the page background. With no `theme-color`
Safari uses a light default, so a site with a dark navbar shows a **white band above the nav on an
iPhone** while looking perfect in every desktop browser and in every screenshot taken at 1440x900.

Reported from a real handset 2026-08-16 ("above navbar isnt color still either, need to fix that
window on iphones"), and the live page had **no theme-color meta at all** — nor did the skill, nor
the template. It had never been set on any build.

Two rules that matter:
- Use the **NAV's** surface colour, not the page's. The nav is what abuts the chrome.
- It must be a **literal hex**. This is emitted into `<head>` at build time, so `var(--surface-dark)`
  resolves to nothing and silently does nothing.

If the nav is transparent over the hero and only gains its fill on scroll, still use the scrolled
fill — the chrome strip is opaque from the first pixel of scroll, which is when the mismatch shows.

