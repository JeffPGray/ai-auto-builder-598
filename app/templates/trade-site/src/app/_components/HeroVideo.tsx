"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Hero background video. Parallax (`data-hero-media`) is on a WRAPPER, never on the
 * <video> — transforming a decoding mp4 with GSAP scrub crashes Chromium tabs
 * (Blue Water 2026-08-21). Pause control stays a sibling of the wrapper.
 */

export type HeroVideoProps = {
  poster: string;
  src?: string;
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
    if (reduce || saveData) return;

    const start = () => {
      const v = ref.current;
      if (!v) return;
      v.preload = "auto";
      v.play().then(
        () => {
          setPlaying(true);
          setUsable(true);
        },
        () => {},
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
        width={1920}
        height={1080}
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
      <div data-hero-media className={`absolute inset-0 overflow-hidden ${className}`}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={ref}
          poster={poster}
          preload="none"
          muted
          playsInline
          loop
          aria-hidden="true"
          tabIndex={-1}
          className="absolute inset-0 h-full w-full object-cover"
        >
          <source src={src} type="video/mp4" />
        </video>
      </div>
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
