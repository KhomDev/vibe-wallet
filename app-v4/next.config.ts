import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

function origin(url: string | undefined): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

// Every host the browser talks to directly. API routes call NEAR AI and 1Click server-side.
const connect = [
  "'self'",
  "https://test.rpc.fastnear.com",
  "https://free.rpc.fastnear.com",
  "https://archival-rpc.testnet.fastnear.com",
  "https://archival-rpc.mainnet.fastnear.com",
  "https://1click.chaindefuser.com",
  "https://api-testnet.nearblocks.io",
  "https://api.nearblocks.io",
  "https://helper.testnet.near.org",
  origin(process.env.NEXT_PUBLIC_NEAR_RPC_URL),
].filter(Boolean);

const csp = [
  "default-src 'self'",
  // Next.js inlines its bootstrap scripts; dev mode also needs eval for fast refresh.
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src ${connect.join(" ")}${dev ? " ws: http://127.0.0.1:* http://localhost:*" : ""}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // The wallet must never be framed: the slide-to-confirm control is a UI-redress target.
  "frame-ancestors 'none'",
  "frame-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
      {
        source: "/download/:path*.apk",
        headers: [
          { key: "Content-Type", value: "application/vnd.android.package-archive" },
          { key: "Content-Disposition", value: 'attachment; filename="vibe-wallet.apk"' },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Content-Type", value: "application/manifest+json" }],
      },
    ];
  },
};

export default nextConfig;
