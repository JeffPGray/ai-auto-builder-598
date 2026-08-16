import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * Hero motion from the stills `/gather` already collects.
 *
 * Deterministic by construction: every value below is a pure function of the frame
 * number and the input props. Two renders of the same client produce byte-identical
 * output (verified: identical SHA-256 across consecutive renders). That is the
 * property a metered generative vendor structurally cannot offer, and it is why
 * this lane exists — five Gray Reserve prospect builds shipped with NO hero video
 * at all when Higgsfield degraded to a Pexels stock still, and nothing detected it.
 *
 * Composition: each photo gets a slow push or pull with a slight drift, and the
 * shots cross-dissolve. No text and no logo here on purpose — the site's own H1 and
 * nav sit on top of this, and burning copy into the video would make it a
 * re-render every time the copy changes.
 */

export type KenBurnsProps = {
  /**
   * Photo paths RELATIVE to the render's publicDir, e.g. "images/patio.jpg".
   * Not file:// URLs: Chrome refuses to load a local file from the bundle's http
   * origin ("Not allowed to load local resource"), so everything goes through
   * staticFile() and is served by Remotion instead.
   */
  images: string[];
  /** Seconds each photo holds, before the crossfade. */
  secondsPerImage: number;
  /** Seconds of crossfade between consecutive photos. */
  crossfadeSeconds: number;
  /** Uniform darkening so white hero text stays legible. Matches the site's wash. */
  scrimOpacity: number;
};

export const kenBurnsDefaults: KenBurnsProps = {
  images: [],
  secondsPerImage: 2.6,
  crossfadeSeconds: 0.7,
  scrimOpacity: 0.55,
};

/** Total frames a set of images needs, so the composition length is derived, never guessed. */
export const durationInFrames = (
  count: number,
  fps: number,
  secondsPerImage: number,
  crossfadeSeconds: number,
) => Math.max(1, Math.round((count * secondsPerImage - (count - 1) * crossfadeSeconds) * fps));

// Alternating push-in / pull-out with a small lateral drift, so consecutive shots
// do not move identically. Index-derived, therefore deterministic.
const move = (i: number) => {
  const pushIn = i % 2 === 0;
  return {
    from: pushIn ? 1.0 : 1.12,
    to: pushIn ? 1.12 : 1.0,
    driftX: i % 4 < 2 ? 1 : -1,
  };
};

export const KenBurns: React.FC<KenBurnsProps> = ({
  images,
  secondsPerImage,
  crossfadeSeconds,
  scrimOpacity,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const hold = secondsPerImage * fps;
  const fade = crossfadeSeconds * fps;
  const step = hold - fade;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {images.map((src, i) => {
        const start = i * step;
        const local = frame - start;
        // Cheap cull: anything not on screen this frame is not rendered at all.
        if (local < -fade || local > hold + fade) return null;

        const opacity = interpolate(
          local,
          [-fade, 0, hold - fade, hold],
          [0, 1, 1, i === images.length - 1 ? 1 : 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );
        const { from, to, driftX } = move(i);
        const scale = interpolate(local, [0, hold], [from, to], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const x = interpolate(local, [0, hold], [0, driftX * 1.6], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

        return (
          <AbsoluteFill key={src} style={{ opacity }}>
            <Img
              src={staticFile(src)}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: `scale(${scale}) translateX(${x}%)`,
              }}
            />
          </AbsoluteFill>
        );
      })}
      {/* Uniform wash across the WHOLE frame, not an edge-only gradient. An
          edge gradient leaves the middle bright and washes out cream hero text —
          the same rule the build skill already enforces for static heroes. */}
      <AbsoluteFill style={{ backgroundColor: `rgba(18,18,16,${scrimOpacity})` }} />
    </AbsoluteFill>
  );
};
