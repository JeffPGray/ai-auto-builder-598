"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Hero background video, rendered by services/hero-video (Remotion, deterministic
 * Ken Burns over the photos `/gather` collected). Drop it inside the hero section:
 *
 *   <section data-hero className="relative ...">
 *     <HeroVideo poster="/hero-poster.jpg" src="/hero.mp4" />
 *     ...headline, CTAs...
 *   </section>
 *
 * Do NOT wrap it in your own `data-hero-media` element. This component puts that
 * attribute on the media itself and keeps the pause control OUTSIDE the transformed
 * subtree. Wrapping both in one parallax target pushes the control off the edge of
 * the screen: measured at x=1508 on a 1440px viewport, because the parallax scales
 * its target to 1.12 and the control went with it.
 *
 * ── WHY IT IS SHAPED LIKE THIS ─────────────────────────────────────────────────
 *
 * THE POSTER IS THE LCP, AND IT IS PROTECTED. Chrome has treated <video> as an LCP
 * candidate since 116, timed at the earlier of poster load or first frame. So the
 * poster ships eager and `preload="none"` keeps the mp4 from competing for
 * bandwidth during the exact window LCP is measured. Playback only starts after the
 * page has loaded. An `autoplay` attribute would download the video immediately,
 * even off-screen, and is exactly the wrong thing here.
 *
 * NEVER FADE THE HERO IN FROM opacity: 0. Elements at zero opacity are excluded
 * from LCP candidacy, which silently pushes LCP to a much later text block. This is
 * also why the hero section must NOT carry `data-reveal`.
 *
 * THERE IS A PAUSE CONTROL, AND IT IS NOT OPTIONAL. WCAG 2.2 SC 2.2.2 (Level A)
 * requires a pause/stop/hide for motion that starts automatically, runs more than
 * five seconds, and plays alongside other content. A looping hero behind a headline
 * meets all three. Muting does not exempt it, and prefers-reduced-motion does not
 * satisfy it either, because most affected users never set the OS flag.
 *
 * IT DEGRADES TO THE STATIC HERO. Reduced motion, Data Saver, a missing file, a
 * decode error: the poster stays and the page is exactly the static hero it was
 * before. There is no state in which the hero is blank.
 */

export type HeroVideoProps = {
  /** First frame of the clip, written by the renderer. Also the LCP image. */
  poster: string;
  /** The clip. Omit and the component renders the poster alone. */
  src?: string;
  /** Alt text for the poster when no video is present. */
  alt?: string;
  className?: string;
};

export default function HeroVideo({ poster, src, alt = "", className = "" }: HeroVideoProps) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [usable, setUsable] = useState(false);

  useEffect(() => {
    if (!src) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const saveData = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection?.saveData;
    if (reduce || saveData) return; // poster only; never even fetch the video

    const start = () => {
      const v = ref.current;
      if (!v) return;
      v.preload = "auto";
      v.play().then(
        () => {
          setPlaying(true);
          setUsable(true);
        },
        () => {
          /* autoplay refused: poster stays, control stays hidden */
        },
      );
    };

    if (document.readyState === "complete") start();
    else {
      window.addEventListener("load", start, { once: true });
      return () => window.removeEventListener("load", start);
    }
  }, [src]);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) void v.play().then(() => setPlaying(true));
    else {
      v.pause();
      setPlaying(false);
    }
  };

  if (!src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        data-hero-media
        src={poster}
        alt={alt}
        fetchPriority="high"
        className={`absolute inset-0 h-full w-full object-cover ${className}`}
      />
    );
  }

  return (
    <>
      <video
        ref={ref}
        data-hero-media
        poster={poster}
        preload="none"
        muted
        playsInline
        loop
        aria-hidden="true"
        tabIndex={-1}
        className={`absolute inset-0 h-full w-full object-cover ${className}`}
      >
        <source src={src} type="video/mp4" />
      </video>
      {/* The control is a SIBLING of the media, never a child. The media carries
          data-hero-media and is scaled 1.12 by the parallax; anything inside that
          subtree is scaled with it and leaves the viewport. */}
      {usable && (
        <button
          type="button"
          onClick={toggle}
          className="sr-only focus:not-sr-only focus:absolute focus:bottom-4 focus:right-4 focus:z-20 focus:rounded-full focus:bg-black/70 focus:px-3 focus:py-1.5 focus:text-xs focus:font-medium focus:text-white focus:outline focus:outline-2 focus:outline-white"
        >
          {playing ? "Pause background video" : "Play background video"}
        </button>
      )}
    </>
  );
}
