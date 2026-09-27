import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
// HTTPS-only directives apply only when the app is served over HTTPS (not a local prod run).
const isHttps = process.env.BETTER_AUTH_URL?.startsWith("https://") ?? false;

/**
 * Static CSP (no nonces, so pages can stay statically optimizable). React/Next
 * need inline bootstrap scripts; everything else is same-origin only.
 * connect-src 'self' covers fetch, SSE (/api/stream) and dev HMR websockets.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isHttps ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // Web Bluetooth only on our own pages; no camera/mic/geolocation.
  {
    key: "Permissions-Policy",
    value: "bluetooth=(self), camera=(), microphone=(), geolocation=(), payment=()",
  },
  ...(isHttps ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      // Health data is private: never let a shared cache keep API responses.
      { source: "/api/(.*)", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
