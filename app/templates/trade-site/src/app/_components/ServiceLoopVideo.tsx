"use client";

/** Background loop for service/about pages — muted autoplay, poster fallback. */
export type ServiceLoopVideoProps = {
  src: string;
  poster: string;
  className?: string;
};

export default function ServiceLoopVideo({ src, poster, className = "" }: ServiceLoopVideoProps) {
  return (
    <div className={`absolute inset-0 overflow-hidden ${className}`} aria-hidden="true">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        className="absolute inset-0 h-full w-full object-cover"
        autoPlay
        muted
        loop
        playsInline
        preload="none"
        poster={poster}
      >
        <source src={src} type="video/mp4" />
      </video>
    </div>
  );
}
