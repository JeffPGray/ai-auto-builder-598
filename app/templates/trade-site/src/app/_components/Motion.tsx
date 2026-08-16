"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Lenis smooth scroll + GSAP ScrollTrigger motion provider.
 *
 * Drop `<Motion />` once in the root layout. Then mark elements:
 *   data-reveal        section or block that fades and rises into place on scroll
 *   data-reveal-group  stagger the element's direct children instead of itself
 *   data-hero-media    hero image/video wrapper that parallaxes as the hero leaves
 *   data-nav           fixed nav that gains a solid background once scrolled
 *
 * ── THE THREE THINGS THIS FILE IS BUILT AROUND ─────────────────────────────────
 *
 * 1. IT FAILS OPEN. The hidden pre-reveal state is NEVER in a static stylesheet.
 *    It is applied from JS, only after this component has mounted and confirmed it
 *    will run, by setting `data-motion="ready"` on <html>. Every rule that hides
 *    content is scoped to that attribute. If the bundle 404s, if JS is disabled, if
 *    a hydration error kills the tree, the page renders fully visible. A build skill
 *    that put `[data-reveal]{opacity:0}` in globals.css would be one JS failure away
 *    from shipping a blank page to a business owner.
 *
 * 2. THERE IS A FAILSAFE. Even with JS alive, a ScrollTrigger that never fires
 *    (bad measurement, a container with its own scroll, an element below a lazy
 *    image that changes layout) would strand content at opacity 0 forever. A
 *    watchdog sweeps every 1.5s for ten sweeps and reveals anything that has passed
 *    its own trigger line and is still invisible. Gray Reserve has shipped exactly
 *    this defect: scroll-reveal verified at the top of the page, passing, while the
 *    rest of the page was invisible.
 *
 * 3. IT IS ROUTE-AWARE. This is a Next App Router site: tapping a <Link> is a CLIENT
 *    navigation. The layout — and therefore this component — never unmounts, so a
 *    mount-only effect builds ScrollTriggers for the FIRST page only. Every section
 *    of every page reached by tapping the menu then inherits `opacity:0` from the
 *    stylesheet below with no trigger that could ever reveal it. That shipped: two
 *    live sites served subpages as "a hero, a white void, and a footer" while a
 *    direct URL load of the same route was perfect, and a 200 response plus a DOM
 *    grep both said the content was there. Reveals are therefore rebuilt on every
 *    `usePathname()` change, and the watchdog below NEVER stops sweeping.
 *
 * 4. NOTHING IS DEFERRED. GSAP and Lenis are ordinary ES module imports bundled by
 *    Next, not <script defer>/<script async> tags. A defer/async optimisation on
 *    GSAP is what froze WooCommerce Cart blocks on a Gray Reserve build; the fix is
 *    to not reach for that lever at all.
 *
 * prefers-reduced-motion turns the whole thing off: no Lenis, no transforms,
 * nothing hidden. The page is simply static, which is the correct reduced-motion
 * experience rather than a degraded one.
 */

const HIDE_ATTR = "data-motion";

/**
 * Per-client motion character.
 *
 * Every site would otherwise reveal with byte-identical numbers, and a
 * hundred sites moving in exactly the same way is the "generic effects applied
 * uniformly" tell — the motion equivalent of every site shipping in Inter. So the
 * numbers below are DERIVED from the business name: deterministic (the same client
 * always animates the same way, which keeps renders reproducible) but different
 * across the fleet.
 *
 * The ranges are deliberately narrow. This varies the *character* of restrained
 * motion; it does not let any client end up with a maximal setting. Values are
 * derived with `gsap.utils` (mapRange / snap / clamp) per the house GSAP skill,
 * rather than hand-rolled arithmetic.
 */
const seedOf = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000; // 0..1
};

// Static, author-controlled stylesheet text. No interpolation of anything that
// could come from gathered content or a visitor.
const MOTION_CSS = `
html.lenis,html.lenis body{height:auto}
.lenis.lenis-smooth{scroll-behavior:auto!important}
.lenis.lenis-smooth [data-lenis-prevent]{overscroll-behavior:contain}
.lenis.lenis-stopped{overflow:hidden}
html[${HIDE_ATTR}="ready"] [data-reveal],
html[${HIDE_ATTR}="ready"] [data-reveal-group]>*{opacity:0}
[data-nav]{transition:background-color .3s ease,box-shadow .3s ease,color .3s ease}
@media (prefers-reduced-motion: reduce){
  html[${HIDE_ATTR}] [data-reveal],
  html[${HIDE_ATTR}] [data-reveal-group]>*{opacity:1 !important;transform:none !important}
}`;

export type MotionProps = {
  /**
   * Anything stable and unique to this business (its name, or the client slug).
   * Seeds the per-client motion character above. Omit and every site animates
   * identically, which is the thing this exists to prevent.
   */
  seed?: string;
};

// Types only — `typeof import(...)` in a type position is erased at compile time and
// does not turn the runtime dynamic imports below into static ones.
type Gsap = (typeof import("gsap"))["gsap"];
type ScrollTriggerType = (typeof import("gsap/ScrollTrigger"))["ScrollTrigger"];

// Default seed is deliberately neutral: it is inlined into the shipped client bundle, and a
// default naming the build tooling discloses the vendor on every prospect site. Every real call
// passes the business name explicitly (`<Motion seed="Mike\'s Bobcat Service" />`), so this value
// is defensive only — but defaults are exactly what leaks when someone forgets to pass one.
export default function Motion({ seed = "site" }: MotionProps) {
  // App Router client navigation swaps the page subtree while this component stays
  // mounted. Without this, reveals are only ever built for the first route loaded.
  const pathname = usePathname();
  const libsRef = useRef<{
    gsap: Gsap;
    ScrollTrigger: ScrollTriggerType;
    lenis: { resize: () => void } | null;
  } | null>(null);
  const ctxRef = useRef<{ revert: () => void } | null>(null);
  const [libsReady, setLibsReady] = useState(0);

  // Force everything visible, whatever state it is in. Every failure path below,
  // and the watchdog, funnel through this.
  const revealAll = () => {
    document.documentElement.setAttribute(HIDE_ATTR, "off");
    document
      .querySelectorAll<HTMLElement>("[data-reveal], [data-reveal-group] > *")
      .forEach((el) => {
        el.style.opacity = "";
        el.style.transform = "";
      });
  };

  // ── Effect A: mount-once. Libraries, Lenis, nav sync, and the watchdog. ───────
  useEffect(() => {
    const root = document.documentElement;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // The nav's solid state is styled off this attribute. Stamp it BEFORE anything
    // that can fail, so a header can never be left matching neither
    // data-scrolled=true nor data-scrolled=false and end up with no background at
    // all over page content. (SiteNav also drives its own state; belt and braces.)
    const nav = document.querySelector<HTMLElement>("[data-nav]");
    const syncNav = () => {
      const n = document.querySelector<HTMLElement>("[data-nav]");
      if (n) n.dataset.scrolled = String(window.scrollY > 80);
    };
    syncNav();
    void nav;

    if (reduce) {
      root.setAttribute(HIDE_ATTR, "off");
      window.addEventListener("scroll", syncNav, { passive: true });
      return () => window.removeEventListener("scroll", syncNav);
    }

    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      try {
        const [lenisMod, gsapMod, stMod] = await Promise.all([
          import("lenis"),
          import("gsap"),
          import("gsap/ScrollTrigger"),
        ]);
        if (cancelled) return;

        const Lenis = lenisMod.default;
        const gsap = (gsapMod.gsap ?? gsapMod.default) as Gsap;
        const ScrollTrigger = (stMod.ScrollTrigger ?? stMod.default) as ScrollTriggerType;
        gsap.registerPlugin(ScrollTrigger);

        // Only now is it safe to hide anything: the libraries are here and Effect B
        // is about to create the tweens that reveal again.
        root.setAttribute(HIDE_ATTR, "ready");

        const lerp = gsap.utils.clamp(
          0.06,
          0.14,
          gsap.utils.mapRange(0, 1, 0.07, 0.13, seedOf(seed)),
        );
        const lenis = new Lenis({ lerp, smoothWheel: true });
        lenis.on("scroll", ScrollTrigger.update);
        lenis.on("scroll", syncNav);
        const tick = (t: number) => lenis.raf(t * 1000);
        gsap.ticker.add(tick);
        gsap.ticker.lagSmoothing(0);

        libsRef.current = { gsap, ScrollTrigger, lenis };
        setLibsReady((n) => n + 1); // hands off to Effect B

        window.addEventListener("scroll", syncNav, { passive: true });

        // Late layout shifts (lazy images finishing, webfonts swapping) move every
        // trigger point. Without this, reveals below the fold measure against a
        // stale document height and can simply never fire.
        const refresh = () => ScrollTrigger.refresh();
        window.addEventListener("load", refresh);
        window.addEventListener("orientationchange", refresh);
        const fontsReady = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts
          ?.ready;
        void fontsReady?.then(refresh);

        cleanup = () => {
          window.removeEventListener("load", refresh);
          window.removeEventListener("orientationchange", refresh);
          window.removeEventListener("scroll", syncNav);
          gsap.ticker.remove(tick);
          ctxRef.current?.revert();
          ScrollTrigger.getAll().forEach((t) => t.kill());
          lenis.destroy();
          libsRef.current = null;
          revealAll();
        };
      } catch (err) {
        // A missing chunk, a CSP block, anything at all: show the page.
        console.error("[motion] disabled:", err);
        revealAll();
      }
    })();

    // ── Watchdog ───────────────────────────────────────────────────────────────
    //
    // "On screen" is NOT the test. An element peeking into the bottom of the
    // viewport has legitimately not reached its own trigger line yet, and treating
    // that as stuck force-reveals the whole page and cancels all motion. The test
    // is: has this element passed its OWN trigger line (top 88% of the viewport)
    // and still not become visible?
    //
    // IT NEVER STOPS. The earlier revision gave up after ten sweeps (15 seconds).
    // A visitor who reads the homepage for twenty seconds and then taps a menu item
    // arrived at the next page with no safety net at all, which is precisely how
    // two live sites shipped subpages that were a hero, a white void and a footer.
    // The sweep is a querySelectorAll over a handful of sections; running it for the
    // life of the page costs nothing and is the only guarantee that scrolling always
    // ends with content on screen.
    const TRIGGER_LINE = 0.88;
    /*
     * STALL DETECTION, not zero detection.
     *
     * The original test was `opacity < 0.05`, and it shipped INVISIBLE CONTENT to production.
     * Measured on the live build 2026-08-16: two in-view sections sat at **opacity 0.0873** — blank
     * to any human eye — and this filter returned ZERO elements to fix, because 0.0873 > 0.05. The
     * watchdog looked straight at invisible content and decided it was fine. That is the operator's
     * "sometimes the home page doesnt render all the content on the scroll on mobile", reproduced.
     *
     * Raising the constant is NOT the fix: any threshold high enough to catch 0.087 also catches
     * every tween legitimately mid-flight, and the watchdog would then fight its own animations and
     * snap them to the end.
     *
     * So the question changes from "is it invisible?" to "is it STUCK?" — an element past the
     * trigger line whose opacity has not INCREASED since the previous sweep is not animating, it is
     * stalled, whatever the value happens to be. A live tween always climbs between sweeps 1.5s
     * apart. This catches 0, catches 0.087, catches a tween killed at 0.4, and never touches one
     * that is still moving.
     */
    const REVEALED = 0.9;
    const lastSeen = new WeakMap<HTMLElement, number>();
    const sweep = () => {
      const stuck = Array.from(
        document.querySelectorAll<HTMLElement>("[data-reveal], [data-reveal-group] > *"),
      ).filter((el) => {
        const r = el.getBoundingClientRect();
        const pastTriggerLine = r.top < window.innerHeight * TRIGGER_LINE && r.bottom > 0;
        if (!pastTriggerLine) { lastSeen.delete(el); return false; }
        const now = Number(getComputedStyle(el).opacity);
        if (now >= REVEALED) { lastSeen.delete(el); return false; }
        const before = lastSeen.get(el);
        lastSeen.set(el, now);
        if (before === undefined) return false;   // first sighting: allow one interval to animate
        return now <= before + 0.01;              // no progress in 1.5s => stalled
      });
      if (!stuck.length) return;
      console.warn(`[motion] ${stuck.length} element(s) past the trigger line and still hidden; revealing them`);
      stuck.forEach((el) => {
        el.style.opacity = "1";
        el.style.transform = "none";
      });
    };
    let queued = 0;
    const onScrollSweep = () => {
      if (queued) return;
      queued = window.requestAnimationFrame(() => {
        queued = 0;
        sweep();
      });
    };
    const watchdog = window.setInterval(sweep, 1500);
    window.addEventListener("scroll", onScrollSweep, { passive: true });
    window.addEventListener("resize", onScrollSweep);
    window.addEventListener("pageshow", sweep);

    return () => {
      cancelled = true;
      window.clearInterval(watchdog);
      if (queued) window.cancelAnimationFrame(queued);
      window.removeEventListener("scroll", onScrollSweep);
      window.removeEventListener("resize", onScrollSweep);
      window.removeEventListener("pageshow", sweep);
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  // ── Effect B: per-route. Rebuild every reveal against the CURRENT page. ───────
  useEffect(() => {
    const libs = libsRef.current;
    if (!libs) return;
    const { gsap, ScrollTrigger, lenis } = libs;

    // Kill the previous route's triggers before measuring the new one.
    ctxRef.current?.revert();

    const k = seedOf(seed);
    const m = gsap.utils;
    /*
     * AMPLITUDE LIFTED 2026-08-16. The previous ranges were rise 18-34px, dur 0.55-0.85s,
     * stagger 0.05-0.11s, parallax 8-16%. Every library loaded, every section was marked, the
     * watchdog worked — and the operator's verdict on the live site was "motion is low... i dont
     * see much motion". He was right: an 18px rise over 0.55s is below the threshold where a
     * visitor registers that anything moved, and a 0.05s stagger across four cards is not a
     * cascade, it is four things arriving together.
     *
     * The old numbers were not a bug, they were timid. Restraint is correct for a dashboard the
     * user visits daily; this is a page a stranger sees ONCE and must find impressive in about two
     * seconds. Doubling the travel and lengthening the ease reads as deliberate rather than fussy.
     *
     * `scaleFrom` is new and does disproportionate work: a section that rises AND settles from
     * 0.985 reads as having depth, where pure translate reads as a slide. Kept very close to 1 —
     * anything under ~0.97 looks like a zoom effect and cheapens instantly.
     *
     * Still seeded, so fleet variety is preserved and builds stay reproducible. Still capped: the
     * top of every range is the point past which motion turns from confident into gaudy.
     */
    const rise = m.snap(2, m.mapRange(0, 1, 36, 64, k)); // px a section travels
    const dur = m.snap(0.05, m.mapRange(0, 1, 0.7, 1.0, k)); // seconds
    const stagger = m.snap(0.01, m.mapRange(0, 1, 0.09, 0.16, k));
    const parallax = m.snap(1, m.mapRange(0, 1, 14, 24, k)); // yPercent of hero drift
    const scaleFrom = m.snap(0.005, m.mapRange(0, 1, 0.985, 0.995, k));
    const heroScale = m.snap(0.01, m.mapRange(0, 1, 1.08, 1.15, k));

    const ctx = gsap.context(() => {
      // Section fade-rise. `once: true` so a section never re-hides on scroll-up.
      gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
        gsap.fromTo(
          el,
          { opacity: 0, y: rise, scale: scaleFrom },
          {
            opacity: 1,
            scale: 1,
            y: 0,
            duration: dur,
            ease: "power2.out",
            scrollTrigger: { trigger: el, start: "top 88%", once: true },
          },
        );
      });

      // Staggered children.
      gsap.utils.toArray<HTMLElement>("[data-reveal-group]").forEach((group) => {
        const kids = Array.from(group.children) as HTMLElement[];
        if (!kids.length) return;
        gsap.fromTo(
          kids,
          { opacity: 0, y: Math.round(rise * 0.8), scale: scaleFrom },
          {
            opacity: 1,
            scale: 1,
            y: 0,
            duration: m.snap(0.05, dur * 0.85),
            ease: "power2.out",
            stagger,
            scrollTrigger: { trigger: group, start: "top 88%", once: true },
          },
        );
      });

      /*
       * NEW HOOKS 2026-08-16 — `data-count` and `data-parallax`.
       *
       * Amplitude was only half the operator's complaint ("motion is low ... i mean usage in the
       * site"). The other half was REACH: the engine offered four hooks, so a page could be fully
       * compliant and still animate in only two places. These add the two highest-value moments a
       * trade site actually has, and neither invents content.
       */

      // data-count="1994" — a figure counts up once, when it scrolls into view. Years trading,
      // jobs completed, review counts. The attribute carries the REAL number from
      // gathered-content.md; the element's text is replaced only while animating, so a JS failure
      // leaves the true figure in the DOM exactly as authored.
      document.querySelectorAll<HTMLElement>("[data-count]").forEach((el) => {
        const target = Number(el.getAttribute("data-count"));
        if (!Number.isFinite(target)) return;
        const prefix = el.getAttribute("data-count-prefix") || "";
        const suffix = el.getAttribute("data-count-suffix") || "";
        const obj = { v: 0 };
        gsap.to(obj, {
          v: target,
          duration: Math.min(2.2, dur * 2.2),
          ease: "power2.out",
          scrollTrigger: { trigger: el, start: "top 85%", once: true },
          onUpdate: () => { el.textContent = prefix + Math.round(obj.v).toLocaleString() + suffix; },
          onComplete: () => { el.textContent = prefix + target.toLocaleString() + suffix; },
        });
      });

      // data-parallax — any image drifts gently as it passes. Depth on the SECOND half of a page,
      // where previously nothing moved but a fade. Deliberately smaller than the hero's drift:
      // a mid-page image that moves as much as the hero fights the copy next to it.
      document.querySelectorAll<HTMLElement>("[data-parallax]").forEach((el) => {
        gsap.fromTo(el,
          { yPercent: -(parallax * 0.35) },
          {
            yPercent: parallax * 0.35,
            ease: "none",
            scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: true },
          });
      });

      // Hero media parallax. Starts pre-scaled so the drift never exposes an edge.
      gsap.utils.toArray<HTMLElement>("[data-hero-media]").forEach((media) => {
        gsap.set(media, { scale: heroScale });
        gsap.to(media, {
          yPercent: parallax,
          scale: 1,
          ease: "none",
          scrollTrigger: {
            trigger: media.closest("[data-hero]") || media,
            start: "top top",
            end: "bottom top",
            scrub: true,
          },
        });
      });
    });
    ctxRef.current = ctx;

    // The new route has a different document height. Measure it, then measure it
    // again once the browser has settled — a soft navigation lands before images
    // have laid out, and a stale measurement is a trigger that never fires.
    lenis?.resize();
    ScrollTrigger.refresh();
    const t = window.setTimeout(() => {
      lenis?.resize();
      ScrollTrigger.refresh();
    }, 300);

    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, libsReady, seed]);

  // Inlined rather than imported from a CSS file. A remote or package `@import` in
  // globals.css is silently dropped by Turbopack on this Next version (see
  // prompts/lessons/build.md), and the hidden-state rules here are the one place
  // where a silently dropped stylesheet would blank the page rather than just look
  // wrong. An inline <style> cannot be dropped.
  return <style>{MOTION_CSS}</style>;
}
