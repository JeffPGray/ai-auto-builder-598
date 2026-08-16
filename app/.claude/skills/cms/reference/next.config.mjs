/** @type {import('next').NextConfig} */
const nextConfig = {
  // No static-export `output` setting — the /admin CMS needs server actions,
  // the session gate and on-demand revalidation, all of which require the
  // standard Next.js server runtime. This site is Vercel-only from the moment
  // the CMS lands. (Deliberately phrased without the literal config string so
  // the deploy skill's static-export grep can never match this comment.)
  images: { unoptimized: true },
  experimental: {
    // Photos are compressed in the browser to ~0.8 MB before upload. The cap
    // sits just under Vercel's hard 4.5 MB function-body limit, so the upload
    // actions' own friendly "photo too large" check (4 MB) is what fires first.
    serverActions: { bodySizeLimit: "4.5mb" },
  },
};

export default nextConfig;
