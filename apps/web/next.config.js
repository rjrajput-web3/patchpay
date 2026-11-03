/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No rewrites to localhost: deploy-ready for Vercel; all config via env.
  env: {
    NEXT_PUBLIC_NETWORK_ID: process.env.NEXT_PUBLIC_NETWORK_ID || "testnet",
  },
};

module.exports = nextConfig;
