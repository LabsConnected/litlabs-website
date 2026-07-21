import type { NextConfig } from "next";

// Note: 'unsafe-eval' / 'wasm-unsafe-eval' are unconditional below (needed for blob workers,
// Turbopack dev chunks, Clerk preview bundles, and emulatorjs). The prior `isDev` guard
// was removed; this declaration is intentionally deleted to satisfy the unused-var lint
// (allowed unused vars must match /^_/u).

const scriptSrcBase = [
  "'self'",
  "'unsafe-inline'",
  "'unsafe-eval'", // Turbopack, blob workers, Clerk bundles, etc.
  "'wasm-unsafe-eval'",
  "https://litlabs.net",
  "https://*.litlabs.net",
  // Clerk (prod + preview/dev instances + their npm CDN bundles)
  "https://*.clerk.com",
  "https://clerk.litlabs.net",
  "https://*.clerk.accounts.dev",
  "https://eternal-chow-60.clerk.accounts.dev",
  "https://js.clerk.dev",
  // Google / GTM / GA
  "https://accounts.google.com",
  "https://www.googletagmanager.com",
  "https://*.google-analytics.com",
  // Cloudflare (challenges + cdn-cgi on own domain + insights)
  "https://challenges.cloudflare.com",
  "https://cdn-cgi.cloudflare.com",
  "https://litlabs.net/cdn-cgi",
  "https://static.cloudflareinsights.com",
  // Vercel (live feedback, insights, speed-insights, chunks, RSC, .well-known)
  "https://vercel.com",
  "https://*.vercel.com",
  "https://vercel.live",
  "https://*.vercel.app",
  "https://litlabs.net/_vercel",
  "https://litlabs.net/_next",
  "https://*.vercel.com/_vercel",
  // Emulator / legacy
  "https://cdn.emulatorjs.org",
  "https://cdn.dos.zone",
];

const scriptSrcGames = [...scriptSrcBase, "'unsafe-eval'", "'wasm-unsafe-eval'"];

// Ensure vercel injected scripts are allowed on all routes
if (!scriptSrcBase.includes("https://vercel.live")) {
  scriptSrcBase.push("https://vercel.live", "https://*.vercel.app");
}

const vercelLiveSrc = " https://vercel.live https://*.vercel.app https://vercel.com https://*.vercel.com https://litlabs.net/_vercel https://litlabs.net/_next";

const CSP_DIRECTIVES = [
  "default-src 'self'",
  `script-src ${scriptSrcBase.join(" ")}`,
  `script-src-elem ${scriptSrcBase.join(" ")} https://eternal-chow-60.clerk.accounts.dev https://litlabs.net/cdn-cgi`,
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline' https://*.clerk.com https://cdn.emulatorjs.org",
  `img-src 'self' data: blob: https://images.unsplash.com https://*.supabase.co https://image.pollinations.ai https://img.clerk.com https://images.clerk.dev https://fal.media https://*.fal.media https://storage.googleapis.com https://img.youtube.com https://*.googleusercontent.com https://lh3.googleusercontent.com https://avatars.githubusercontent.com https://upload.wikimedia.org https://placehold.co https://vercel.com https://cdn.emulatorjs.org${vercelLiveSrc}`,
  "font-src 'self' data: https://*.clerk.com https://cdn.emulatorjs.org",
  `connect-src 'self' blob: data: https://*.clerk.com https://*.clerk.accounts.dev https://eternal-chow-60.clerk.accounts.dev https://api.clerk.dev https://clerk.litlabs.net https://clerk-telemetry.com https://*.clerk-telemetry.com https://*.supabase.co wss://*.supabase.co https://api.openai.com https://openrouter.ai https://api.stripe.com https://fal.run https://fal.ai https://*.fal.run wss://*.fal.run https://image.pollinations.ai https://cloud.activepieces.com https://api.minimax.chat https://together.xyz https://api.together.xyz https://cloudflareinsights.com https://*.cloudflareinsights.com https://litlabs.net https://*.up.railway.app wss://*.up.railway.app https://cdn.emulatorjs.org https://cdn.dos.zone https://raw.githubusercontent.com https://github.com https://api.github.com https://www.google-analytics.com https://*.google-analytics.com https://litlabs.net/_vercel https://litlabs.net/_next https://litlabs.net/.well-known${vercelLiveSrc}`,
  "frame-src 'self' data: blob: https://open.spotify.com https://js.stripe.com https://accounts.google.com https://challenges.cloudflare.com https://*.clerk.com https://*.clerk.accounts.dev https://eternal-chow-60.clerk.accounts.dev https://*.github.io https://pacman.platzh1rsch.ch https://*.sudoku100.com https://minesweeper.github.io https://cdn.emulatorjs.org https://vercel.live https://*.vercel.app",
  "worker-src 'self' blob: data: https://litlabs.net https://*.litlabs.net https://*.vercel.com https://vercel.live https://cdn.emulatorjs.org https://cdn.dos.zone",
  "media-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://*.clerk.com https://*.clerk.accounts.dev",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

// Relaxed CSP for /games routes — emulatorjs requires unsafe-eval
const CSP_DIRECTIVES_GAMES = CSP_DIRECTIVES.replace(
  `script-src ${scriptSrcBase.join(" ")}`,
  `script-src ${scriptSrcGames.join(" ")}`,
).replace(
  `script-src-elem ${scriptSrcBase.join(" ")}`,
  `script-src-elem ${scriptSrcGames.join(" ")}`,
);

const nextConfig: NextConfig = {
  // ============================================
  // PERFORMANCE OPTIMIZATIONS
  // ============================================

  // Allow local browser previews and proxy origins in dev
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.0.77"],

  // Avoid Windows EPERM errors during .next cleanup
  cleanDistDir: false,

  // Turbopack workspace root (fixes lockfile detection warning)
  turbopack: {
    root: __dirname,
  },

  reactStrictMode: false,

  experimental: {
    optimizePackageImports: [
      "@supabase/supabase-js",
      "lucide-react",
      "@clerk/nextjs",
      "react-markdown",
      "@aws-sdk/client-s3",
      "@aws-sdk/s3-request-presigner",
      "@google/genai",
      "@google/generative-ai",
      "stripe",
      "supermemory",
      "monaco-editor",
    ],
  },

  // Externalize jose from middleware bundling (fixes NFT build error)
  serverExternalPackages: ["jose"],

  // Image optimization
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "image.pollinations.ai",
      },
      {
        protocol: "https",
        hostname: "img.youtube.com",
      },
      {
        protocol: "https",
        hostname: "img.clerk.com",
      },
      {
        protocol: "https",
        hostname: "images.clerk.dev",
      },
      {
        protocol: "https",
        hostname: "**.r2.cloudflarestorage.com",
      },
      {
        protocol: "https",
        hostname: "**.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
    ],
  },

  productionBrowserSourceMaps: true,
  compress: true,
  poweredByHeader: false,

  // ============================================
  // CACHING & HEADERS
  // ============================================

  async headers() {
    return [
      // Security headers
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value:
              "geolocation=(), microphone=(self), camera=(self), payment=(self), usb=(), interest-cohort=()",
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "unsafe-none",
          },
          {
            key: "Content-Security-Policy",
            value: CSP_DIRECTIVES,
          },
          // Also emit Report-Only with the same policy so reports are evaluated against our allow-list
          // (instead of any minimal platform-injected report-only like "script-src 'unsafe-inline' 'unsafe-eval'" or "connect-src 'none'")
          {
            key: "Content-Security-Policy-Report-Only",
            value: CSP_DIRECTIVES,
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
      // Relaxed CSP for /games routes — emulatorjs requires unsafe-eval
      {
        source: "/games/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: CSP_DIRECTIVES_GAMES,
          },
        ],
      },
      // Cache static assets for 1 year
      {
        source: "/static/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      // Cache fonts for 1 year
      {
        source: "/fonts/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      // Cache images for 30 days
      {
        source: "/images/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=2592000, stale-while-revalidate=86400",
          },
        ],
      },
      // Cache Next.js static chunks for 1 year
      {
        source: "/_next/static/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },

  // ============================================
  // ISR & REVALIDATION
  // ============================================

  async redirects() {
    return [
      // Legacy Builder/Studio routes → unified /studio (temporary while architecture evolves)
      { source: "/builder", destination: "/studio", permanent: false },
      { source: "/ai-builder", destination: "/studio", permanent: false },
      { source: "/chat", destination: "/studio", permanent: false },
      { source: "/code", destination: "/studio?intent=code", permanent: false },
      { source: "/litt", destination: "/studio", permanent: false },
      { source: "/litt-terminal", destination: "/studio?panel=terminal", permanent: false },
      { source: "/flow", destination: "/studio?intent=loop", permanent: false },
      { source: "/generate", destination: "/studio?intent=image", permanent: false },
      { source: "/studio/image", destination: "/studio?intent=image", permanent: false },

      // Legacy agent routes → /agents or /studio
      { source: "/agent", destination: "/agents", permanent: false },
      { source: "/agent-chat", destination: "/studio?intent=agent", permanent: false },

      // Retired pages — permanent redirects
      { source: "/creator", destination: "/dashboard", permanent: true },
      { source: "/landing", destination: "/", permanent: true },
      { source: "/login", destination: "/sign-in", permanent: true },
    ];
  },

  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
