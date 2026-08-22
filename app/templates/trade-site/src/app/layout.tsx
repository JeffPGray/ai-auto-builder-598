/**
 * Template root layout — 1:1 chrome ownership with bluegrass-blast-pw.
 * Opus swaps next/font pairing + metadata copy; does NOT re-home SiteNav/Footer into pages.
 */
import type { Metadata, Viewport } from "next";
import { Newsreader, Chivo } from "next/font/google";
import "./globals.css";
import Motion from "./_components/Motion";
import SiteChat from "./_components/SiteChat";
import SiteNav from "./_components/SiteNav";
import SiteFooter from "./_components/SiteFooter";
import BusinessJsonLd from "./_components/BusinessJsonLd";
import { biz, SITE_URL } from "./_components/site-data";

/* Opus replaces Newsreader/Chivo with the consult uniqueness pairing. */
const display = Newsreader({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "600"],
  style: ["normal", "italic"],
  variable: "--font-display-src",
});

const body = Chivo({
  subsets: ["latin"],
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-body-src",
});

export const metadata: Metadata = {
  title: {
    default: `${biz.name} | ${biz.address.city}, ${biz.address.state}`,
    template: `%s | ${biz.shortName}`,
  },
  description: biz.tagline,
  robots: { index: false, follow: false },
  alternates: { canonical: SITE_URL },
  openGraph: {
    title: biz.name,
    description: biz.tagline,
    url: SITE_URL,
    siteName: biz.name,
    locale: "en_US",
    type: "website",
    images: [
      {
        url: `${SITE_URL}/og.jpg`,
        width: 1200,
        height: 630,
        alt: `${biz.name} — ${biz.tagline}`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: biz.name,
    description: biz.tagline,
    images: [`${SITE_URL}/og.jpg`],
  },
};

export const viewport: Viewport = {
  themeColor: "#191C16",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <head>
        <BusinessJsonLd />
      </head>
      <body className="font-body">
        <Motion seed={biz.name} />
        <SiteNav />
        <main>{children}</main>
        <SiteFooter />
        <SiteChat businessName={biz.name} phoneDisplay={biz.phone} />
      </body>
    </html>
  );
}
