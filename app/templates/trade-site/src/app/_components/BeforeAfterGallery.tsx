"use client";

import { useCallback, useRef, useState } from "react";

export type BeforeAfterPair = {
  before: string;
  after: string;
  label?: string;
  altBefore?: string;
  altAfter?: string;
};

export type BeforeAfterGalleryProps = {
  pairs: BeforeAfterPair[];
  className?: string;
};

function BeforeAfterSlide({ pair }: { pair: BeforeAfterPair }) {
  const [pct, setPct] = useState(52);
  const dragging = useRef(false);

  const move = useCallback((clientX: number, rect: DOMRect) => {
    const x = ((clientX - rect.left) / rect.width) * 100;
    setPct(Math.min(96, Math.max(4, x)));
  }, []);

  return (
    <figure className="before-after relative aspect-[4/3] w-full overflow-hidden rounded-sm bg-surface-dark shadow-lg">
      {pair.label && (
        <figcaption className="absolute left-3 top-3 z-20 rounded bg-black/55 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-white">
          {pair.label}
        </figcaption>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={pair.after}
        alt={pair.altAfter || "After project completion"}
        className="absolute inset-0 h-full w-full object-cover"
        loading="lazy"
      />
      <div className="absolute inset-0 overflow-hidden" style={{ width: `${pct}%` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={pair.before}
          alt={pair.altBefore || "Before project started"}
          className="absolute inset-0 h-full w-full max-w-none object-cover"
          style={{ width: `${100 / (pct / 100)}%` }}
          loading="lazy"
        />
      </div>
      <div
        className="absolute inset-y-0 z-10 w-1 cursor-ew-resize bg-white/90 shadow-md"
        style={{ left: `calc(${pct}% - 2px)` }}
        role="slider"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Drag to compare before and after"
        tabIndex={0}
        onPointerDown={(e) => {
          dragging.current = true;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          move(e.clientX, e.currentTarget.parentElement!.getBoundingClientRect());
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          move(e.clientX, e.currentTarget.parentElement!.getBoundingClientRect());
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
      />
      <span className="pointer-events-none absolute bottom-3 left-3 z-20 text-xs font-semibold uppercase tracking-wider text-white drop-shadow">
        Before
      </span>
      <span className="pointer-events-none absolute bottom-3 right-3 z-20 text-xs font-semibold uppercase tracking-wider text-white drop-shadow">
        After
      </span>
    </figure>
  );
}

/** Lazy, accessible before/after compare slider for proof galleries (landscaping, tree, detail). */
export default function BeforeAfterGallery({ pairs, className = "" }: BeforeAfterGalleryProps) {
  if (!pairs.length) return null;
  return (
    <div
      className={`grid gap-6 sm:grid-cols-2 ${className}`}
      data-reveal-group
    >
      {pairs.map((pair, i) => (
        <BeforeAfterSlide key={`${pair.before}-${i}`} pair={pair} />
      ))}
    </div>
  );
}
