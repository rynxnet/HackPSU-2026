/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // Canvas fallback for pdf.js in browser
    config.resolve.alias.canvas = false;
    config.resolve.alias.encoding = false;
    return config;
  },
  // /api/v1/* is proxied to the backend by src/app/api/v1/[...path]/route.ts.
  // Don't add a rewrite for it: rewrites take precedence over that route and
  // time out after 30s, which cuts off slow Gemini chat responses.
};

export default nextConfig;
