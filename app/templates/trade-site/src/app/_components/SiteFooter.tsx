/**
 * Template SiteFooter — 1:1 structure with bluegrass-blast-pw fixture.
 * Links come from NAV_LINKS (+ children). Opus fills biz tagline / hours / NAP.
 */
import Link from "next/link";
import { biz, NAV_LINKS } from "./site-data";

const GaugeNeedle = () => (
  <svg
    className="gauge-needle"
    viewBox="0 0 28 28"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <circle cx="14" cy="14" r="12" stroke="currentColor" strokeWidth="1.5" fill="none" />
    <circle cx="14" cy="14" r="2.5" fill="currentColor" />
    <line
      x1="14"
      y1="14"
      x2="22"
      y2="8"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <path
      d="M6 20 A10 10 0 0 1 6 8"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      opacity="0.4"
    />
  </svg>
);

export default function SiteFooter() {
  const flatLinks = NAV_LINKS.flatMap((link) =>
    link.children?.length
      ? [{ href: link.href, label: `All ${link.label}` }, ...link.children]
      : [{ href: link.href, label: link.label }]
  );

  return (
    <footer className="bg-surface-6 text-on-dark relative grain">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-y-10 gap-x-12 relative z-10">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/logo.webp"
              alt={biz.name}
              width={900}
              height={705}
              className="h-16 w-auto mb-5 brightness-110"
            />
            <p className="text-on-dark-muted text-sm leading-relaxed mb-4">
              {biz.footerBlurb || biz.tagline}
            </p>
            <address className="not-italic text-sm text-on-dark-muted space-y-1">
              <p>{biz.address.street}</p>
              <p>
                {biz.address.city}, {biz.address.state} {biz.address.zip}
              </p>
            </address>
          </div>

          <div>
            <h3 className="font-display text-lg font-semibold text-on-dark mb-4">Quick Links</h3>
            <ul className="space-y-2.5 text-sm">
              {flatLinks.map((item) => (
                <li key={item.href + item.label}>
                  <Link
                    href={item.href}
                    className="text-on-dark-muted hover:text-accent-dark transition-colors"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="font-display text-lg font-semibold text-on-dark mb-4">Get in Touch</h3>
            <div className="space-y-3 text-sm">
              <a
                href={biz.phoneHref}
                className="flex items-center gap-2 text-accent-dark hover:text-on-dark transition-colors font-semibold text-base"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                  />
                </svg>
                {biz.phone}
              </a>
              {biz.email ? (
                <a
                  href={`mailto:${biz.email}`}
                  className="flex items-center gap-2 text-on-dark-muted hover:text-accent-dark transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                  {biz.email}
                </a>
              ) : null}
            </div>

            <div className="gauge-divider mt-6">
              <GaugeNeedle />
            </div>

            {biz.hoursLines?.length ? (
              <div className="text-sm text-on-dark-muted">
                <p className="font-semibold text-on-dark mb-2">Hours</p>
                {biz.hoursLines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="relative z-10 mt-12 pt-6 border-t border-on-dark-15 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-on-dark-muted">
          <p>
            &copy; {new Date().getFullYear()} {biz.name}. All rights reserved.
            {biz.insuredNote ? ` ${biz.insuredNote}` : ""}
          </p>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-on-dark transition-colors">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-on-dark transition-colors">
              Terms of Service
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
