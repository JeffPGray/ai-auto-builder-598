# Scroll-scrub hero (Tier 2 — opt-in, not fleet default)

Premium agency pattern: extract 30–60 frames from hero or service loop → WebP strip → GSAP ScrollTrigger scrubs canvas (`data-scroll-scrub`).

**Why not default:** build cost + author complexity. Use for flagship verticals only.

**Pipeline (when enabled per client):**

1. After `render-hero.mjs`, run `ffmpeg` frame extract to `public/hero-scrub/frame-%03d.webp`
2. Mark home hero wrapper `data-scroll-scrub="/hero-scrub/manifest.json"`
3. `Motion.tsx` registers scrub only when manifest exists; poster remains LCP

**Performance budget:** ≤900KB total frames, lazy-decode off idle callback.

Fleet default remains **HF loop + GSAP parallax** (`data-hero-media`).
