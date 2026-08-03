import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,

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

  experimental: {
    turbopackFileSystemCacheForBuild: true,
    optimizePackageImports: [
      "@supabase/supabase-js",
      "lucide-react",
      "@clerk/nextjs",
      "react-markdown",
      "zustand",
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

  productionBrowserSourceMaps: false,
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
              "geolocation=(), microphone=(self), camera=(self), display-capture=(self), payment=(self), usb=(), interest-cohort=(), gamepad=(self)",
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
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://*.clerk.com https://clerk.litlabs.net https://*.clerk.accounts.dev https://js.clerk.dev https://accounts.google.com https://www.googletagmanager.com https://challenges.cloudflare.com https://cdn-cgi.cloudflare.com https://static.cloudflareinsights.com https://litlabs.net https://vercel.live https://cdn.emulatorjs.org https://v8.js-dos.com",
              "script-src-elem 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://*.clerk.com https://clerk.litlabs.net https://*.clerk.accounts.dev https://js.clerk.dev https://accounts.google.com https://www.googletagmanager.com https://challenges.cloudflare.com https://cdn-cgi.cloudflare.com https://static.cloudflareinsights.com https://litlabs.net https://vercel.live https://cdn.emulatorjs.org https://v8.js-dos.com",
              "script-src-attr 'none'",
              "style-src 'self' 'unsafe-inline' https://*.clerk.com https://cdn.emulatorjs.org https://v8.js-dos.com",
              "style-src-elem 'self' 'unsafe-inline' https://*.clerk.com https://cdn.emulatorjs.org https://v8.js-dos.com",
              "img-src 'self' data: blob: https://images.unsplash.com https://*.supabase.co https://image.pollinations.ai https://img.clerk.com https://images.clerk.dev https://fal.media https://storage.googleapis.com https://img.youtube.com https://*.googleusercontent.com https://lh3.googleusercontent.com https://avatars.githubusercontent.com https://upload.wikimedia.org https://placehold.co https://vercel.com https://vercel.live https://cdn.emulatorjs.org https://v8.js-dos.com https://thumbnails.libretro.com",
              "font-src 'self' data: https://*.clerk.com https://cdn.emulatorjs.org https://v8.js-dos.com https://vercel.live",
              "connect-src 'self' blob: https://*.clerk.com https://*.clerk.accounts.dev https://api.clerk.dev https://clerk.litlabs.net https://clerk-telemetry.com https://*.supabase.co wss://*.supabase.co https://api.openai.com https://openrouter.ai https://api.stripe.com https://fal.run https://fal.ai wss://*.fal.run https://image.pollinations.ai https://cloud.activepieces.com https://api.minimax.chat https://together.xyz https://api.together.xyz https://cloudflareinsights.com https://litlabs.net https://*.up.railway.app wss://*.up.railway.app wss://*.pusher.com https://*.pusher.com ws://localhost:* wss://localhost:* https://cdn.emulatorjs.org https://v8.js-dos.com https://cdn.dos.zone",
              "frame-src 'self' blob: data: https: http: https://open.spotify.com https://js.stripe.com https://accounts.google.com https://challenges.cloudflare.com https://*.clerk.com https://*.clerk.accounts.dev https://*.github.io https://pacman.platzh1rsch.ch https://*.sudoku100.com https://minesweeper.github.io",
              "worker-src 'self' blob: https://litlabs.net https://cdn.emulatorjs.org https://v8.js-dos.com",
              "media-src 'self' blob: data:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "upgrade-insecure-requests",
            ].join("; "),
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
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
      // Versioned EmulatorJS runtime assets — immutable.
      // NOTE: CORP same-origin was removed — it may block the 7z decompression
      // worker from reading responses inside the srcdoc iframe in some browsers.
      // Missing files must return a real 404, never an HTML fallback.
      {
        source: "/emulatorjs/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      // Arcade runtime iframe host — must be frameable by same-origin.
      // Overrides the global X-Frame-Options: DENY so the emulator iframe
      // (loaded from /arcade-runtime/emulator-session.html) can be embedded
      // by the parent page at /games/retro/play/[gameId].
      // SAMEORIGIN is safe — only litlabs.net can embed these pages.
      //
      // IMPORTANT: We also override the CSP for this path. The EmulatorJS
      // 7z decompression worker (extract7z.js) runs inside a blob: Web Worker
      // and uses WASM. The parent page's strict CSP is inherited by the
      // same-origin iframe and can block the worker's WASM compilation or
      // postMessage calls, causing the "Decompress Game Core 99%" stall.
      // This permissive CSP allows everything the emulator needs while still
      // blocking external framing (X-Frame-Options: SAMEORIGIN).
      {
        source: "/arcade-runtime/:path*",
        headers: [
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "object-src 'none'",
              // unsafe-eval + wasm-unsafe-eval belong in script-src (NOT
              // script-src-elem). Firefox ignores them in script-src-elem.
              // EmulatorJS needs them for WASM compilation + 7z worker.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: data:",
              "script-src-elem 'self' 'unsafe-inline' blob: data:",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' blob: data:",
              "font-src 'self' data:",
              "connect-src 'self' blob:",
              "media-src 'self' blob: data:",
              "worker-src 'self' blob:",
              "child-src 'self' blob:",
              "frame-ancestors 'self'",
            ].join("; "),
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
      { source: "/builder", destination: "/studio", permanent: false },
      { source: "/ai-builder", destination: "/studio", permanent: false },
      { source: "/chat", destination: "/studio?tool=chat", permanent: true },
      { source: "/code", destination: "/studio?intent=code", permanent: false },
      { source: "/litt", destination: "/studio?tool=chat", permanent: true },
      {
        source: "/litt-terminal",
        destination: "/studio?tool=terminal",
        permanent: true,
      },
      { source: "/flow", destination: "/studio?intent=loop", permanent: false },
      {
        source: "/generate",
        destination: "/studio?intent=image",
        permanent: false,
      },
      {
        source: "/studio/image",
        destination: "/studio?intent=image",
        permanent: false,
      },
      { source: "/agent", destination: "/studio?tool=workflows", permanent: false },
      { source: "/agents", destination: "/studio?tool=workflows", permanent: false },
      {
        source: "/agent-chat",
        destination: "/studio?tool=agents",
        permanent: true,
      },
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
