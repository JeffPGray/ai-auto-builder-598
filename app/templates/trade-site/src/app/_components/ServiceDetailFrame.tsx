import Link from "next/link";
import { biz } from "./site-data";

/**
 * Service detail frame — BOTH lanes (shared + dedicated).
 * Enforces section styling the flat gradient+white author path kept skipping:
 * photo-ground hero + band-depth-frost body (hatch is accent-only — see ATMOSPHERE.md).
 * No trailing money-band chrome — CTAs live in the body. Authors pass copy + image.
 */
export type ServiceDetailProps = {
  station: string;
  title: string;
  short: string;
  body: string;
  expect?: string;
  proofLine?: string;
  imageSrc: string;
  imageAlt: string;
  imageWidth: number;
  imageHeight: number;
  objectPosition?: string;
};

export default function ServiceDetailFrame({
  station,
  title,
  short,
  body,
  expect,
  proofLine,
  imageSrc,
  imageAlt,
  imageWidth,
  imageHeight,
  objectPosition = "50% 40%",
}: ServiceDetailProps) {
  const proof =
    proofLine ||
    `${biz.shortName} — ${biz.insuredNote || "Licensed and insured."} Call ${biz.phoneDisplay}.`;

  return (
    <>
      <section
        data-hero
        className="photo-ground relative isolate overflow-hidden bg-surface-6 pb-20 pt-40 grain"
        aria-labelledby="service-h1"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          data-photo-treatment="scrim"
          src={imageSrc}
          alt=""
          aria-hidden="true"
          width={imageWidth}
          height={imageHeight}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition }}
        />
        <div className="photo-ground-wash absolute inset-0 z-[1]" />
        <div className="hero-overlay hero-overlay--split absolute inset-0 z-[2]" />
        <div className="relative z-10 mx-auto max-w-6xl px-5 lg:px-8">
          <p className="font-display text-sm font-bold tracking-[0.2em] text-accent-text-dark">
            {station}
          </p>
          <h1
            id="service-h1"
            className="font-display mt-3 max-w-3xl text-4xl font-bold text-on-dark sm:text-5xl"
          >
            {title}
          </h1>
          <p className="font-body mt-4 max-w-2xl text-lg text-on-dark-muted">{short}</p>
          <div className="mt-8 flex flex-wrap gap-4">
            <a href={biz.phoneHref} className="cta-primary">
              Call {biz.phoneDisplay}
            </a>
            <Link href="/contact" className="cta-secondary text-on-dark">
              Free inspection
            </Link>
          </div>
        </div>
      </section>

      <section
        className="band-depth-frost relative overflow-hidden py-16 md:py-24"
        data-reveal
      >
        <div className="relative z-10 mx-auto grid max-w-6xl gap-y-10 px-5 md:grid-cols-12 md:gap-x-10 lg:px-8">
          <div className="md:col-span-7">
            <div className="signature-spine mb-6">
              <div className="signature-spine__rail signature-spine__rail--h" aria-hidden="true" />
              <h2 className="font-display text-2xl font-bold text-ink">How this job works</h2>
            </div>
            <p className="font-body text-ink-muted leading-relaxed">{body}</p>
            {expect ? (
              <p className="font-body mt-6 text-ink-muted leading-relaxed">{expect}</p>
            ) : null}
            <p className="font-body mt-6 text-ink leading-relaxed">{proof}</p>
            <div className="mt-8 flex flex-wrap gap-4">
              <a href={biz.phoneHref} className="cta-primary">
                Call {biz.phoneDisplay}
              </a>
              <Link href="/contact" className="cta-secondary-ink">
                Request inspection
              </Link>
            </div>
          </div>
          <div className="relative md:col-span-5 aspect-[4/3] overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              data-photo-treatment="contained"
              src={imageSrc}
              alt={imageAlt}
              width={imageWidth}
              height={imageHeight}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
              style={{ objectPosition }}
            />
            <div className="cinema-grade cinema-grade--dealer absolute inset-0" />
          </div>
        </div>
        <p className="watermark watermark--gutter" aria-hidden="true">
          WORK
        </p>
      </section>
    </>
  );
}
