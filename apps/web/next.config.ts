import type { NextConfig } from "next";

export const productSecurityHeaders = [
  {
    key: "Content-Security-Policy",
    value: "base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=()",
  },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Frame-Options", value: "DENY" },
] as const;

const nextConfig: NextConfig = {
  // Keep development chrome from covering the guided-demo controls.
  devIndicators: false,
  // TRK-01/WAL-01: the participant-only test proxy does not expose dev sockets.
  // Keep hydration on the normal response stream, not the private debug channel.
  ...(process.env.EXTERNAL_DEVNET_PUBLIC_GATE === "1"
    ? { experimental: { reactDebugChannel: false } }
    : {}),
  async headers() {
    return [{ source: "/:path*", headers: [...productSecurityHeaders] }];
  },
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@landed/contracts", "@landed/ui"],
};

export default nextConfig;
