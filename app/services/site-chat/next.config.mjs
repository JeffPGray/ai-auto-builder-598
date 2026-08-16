/** @type {import('next').NextConfig} */
const nextConfig = {
  // This app is a SERVER app on purpose. It is the only server-side surface in the
  // whole Klaudius fleet: the client sites stay `output: 'export'` static.
};

export default nextConfig;
