import React from "react";
import { Composition } from "remotion";
import { KenBurns, kenBurnsDefaults, durationInFrames, type KenBurnsProps } from "./KenBurns";

export const FPS = 30;
// 720p, not 1080p. Slow Ken Burns pans are a hard case for an encoder — every pixel
// moves slightly on every frame, so motion vectors are non-zero everywhere and the
// bitrate does not collapse the way it does on a static shot. 720p/CRF 34 measured
// 585 KB for a 5s clip against 2.08 MB at 1080p/CRF 26, for a difference nobody
// sees behind a 55% scrim at hero size.
export const WIDTH = 1280;
export const HEIGHT = 720;

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Hero"
    component={KenBurns}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
    defaultProps={kenBurnsDefaults}
    // Length is DERIVED from the number of photos, never hardcoded. A client with
    // three usable photos and a client with six both get a correctly-timed clip.
    calculateMetadata={({ props }: { props: KenBurnsProps }) => ({
      durationInFrames: durationInFrames(
        Math.max(1, props.images.length),
        FPS,
        props.secondsPerImage,
        props.crossfadeSeconds,
      ),
    })}
  />
);
