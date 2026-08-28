import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  reactCompiler: true,

  // Standalone output — produces a minimal self-contained server in
  // .next/standalone that doesn't need node_modules at runtime. This is
  // the recommended mode for Docker deployments (Railway). The Dockerfile
  // copies .next/standalone + .next/static + public into the runtime image.
  output: "standalone",

  // Production builds MUST fail on TypeScript errors.
  //
  // This was `ignoreBuildErrors: true`, justified by "tsc --noEmit is run
  // separately and passes cleanly". It did not: the CLI package failed to
  // compile for weeks behind this flag, because vitest transpiles without
  // type-checking and nothing else gated the build. A type error that
  // cannot fail any pipeline is a type error nobody sees.
  typescript: {
    ignoreBuildErrors: false,
  },

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
      "react-markdown",
      "zustand",
    ],
    // Server Actions origin validation (CSRF protection).
    //
    // Next.js rejects Server Action POSTs when the browser's Origin header
    // doesn't match the Host / X-Forwarded-Host header. Behind reverse
    // proxies (Cloudflare → Railway) the proxy-origin can differ from the
    // internal host, and in local dev a tunnel/proxy (e.g. stitch-mcp,
    // cloudflared) can forward to localhost:3001 while the browser's Origin
    // is 127.0.0.1:<dynamic-port>.  Listing the trusted frontend origins
    // here lets those legitimate cross-host action requests through without
    // disabling the CSRF check entirely.
    //
    // Production domains:
    //   litlabs.net / www.litlabs.net  — Cloudflare → Railway
    //   *.up.railway.app               — direct Railway internal domain
    //
    // Local dev origins:
    //   localhost:3001 / 127.0.0.1:3001 — direct dev server access
    //
    // NOTE: tunnel/proxy origins with dynamic ports (e.g. 127.0.0.1:21151)
    // cannot be statically listed. The correct fix for those is to configure
    // the proxy to set X-Forwarded-Host to the *original* request host (not
    // the destination). This config covers the known stable origins.
    serverActions: {
      allowedOrigins: [
        // Production — Cloudflare frontend
        "litlabs.net",
        "www.litlabs.net",
        // Production — Railway internal domain
        "*.up.railway.app",
        // Local dev — direct access
        "localhost:3001",
        "127.0.0.1:3001",
        "[::1]:3001",
      ],
    },
  },

  // Clerk must be transpiled by Next.js so that ClerkProvider (root layout)
  // and useSession() (used inside <SignIn/>) share ONE React context instance.
  // Without this, Turbopack can emit two separate copies of @clerk/react
  // in the client bundle — each with its own createContext() — so the context
  // ClerkProvider sets is not the same context useSession reads from, causing
  // "useSession can only be used within the <ClerkProvider /> component" on the
  // /sign-in page even though ClerkProvider is present in the tree.
  //
  // NOTE: @clerk/clerk-react was renamed to @clerk/react in Clerk Core 3
  // (shipped with @clerk/nextjs v7). The old package name is no longer used.
  transpilePackages: [
    "@clerk/nextjs",
    "@clerk/react",
    "@clerk/shared",
  ],

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
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://*.clerk.com https://*.clerk.accounts.dev https://js.clerk.dev https://clerk.litlabs.net https://accounts.google.com https://challenges.cloudflare.com https://cdn-cgi.cloudflare.com https://static.cloudflareinsights.com https://litlabs.net https://www.litlabs.net https://cdn.emulatorjs.org https://v8.js-dos.com https://link.msgsndr.com",
              "script-src-elem 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://*.clerk.com https://*.clerk.accounts.dev https://js.clerk.dev https://clerk.litlabs.net https://accounts.google.com https://challenges.cloudflare.com https://cdn-cgi.cloudflare.com https://static.cloudflareinsights.com https://litlabs.net https://www.litlabs.net https://cdn.emulatorjs.org https://v8.js-dos.com https://link.msgsndr.com",
              "script-src-attr 'none'",
              "style-src 'self' 'unsafe-inline' https://*.clerk.com https://cdn.emulatorjs.org https://v8.js-dos.com",
              "style-src-elem 'self' 'unsafe-inline' https://*.clerk.com https://cdn.emulatorjs.org https://v8.js-dos.com",
              "img-src 'self' data: blob: https://images.unsplash.com https://*.supabase.co https://image.pollinations.ai https://img.clerk.com https://images.clerk.dev https://fal.media https://storage.googleapis.com https://img.youtube.com https://*.googleusercontent.com https://lh3.googleusercontent.com https://avatars.githubusercontent.com https://upload.wikimedia.org https://placehold.co https://vercel.com https://cdn.emulatorjs.org https://v8.js-dos.com https://thumbnails.libretro.com",
              "font-src 'self' data: https://*.clerk.com https://cdn.emulatorjs.org https://v8.js-dos.com",
              `connect-src 'self' blob: https://*.clerk.com https://*.clerk.accounts.dev https://api.clerk.dev https://api.clerk.com https://clerk-telemetry.com https://clerk.litlabs.net https://*.supabase.co wss://*.supabase.co https://api.openai.com https://openrouter.ai https://api.stripe.com https://fal.run https://fal.ai wss://*.fal.run https://image.pollinations.ai https://cloud.activepieces.com https://api.minimax.chat https://together.xyz https://api.together.xyz https://cloudflareinsights.com https://litlabs.net https://*.up.railway.app wss://*.up.railway.app wss://*.pusher.com https://*.pusher.com https://cdn.emulatorjs.org https://v8.js-dos.com https://cdn.dos.zone https://backend.leadconnectorhq.com https://link.msgsndr.com https://generativelanguage.googleapis.com wss://generativelanguage.googleapis.com https://*.livekit.cloud wss://*.livekit.cloud${process.env.NODE_ENV === "development" ? " ws://localhost:4001 http://localhost:4001 ws://127.0.0.1:4001 http://127.0.0.1:4001" : ""}`,
              "frame-src 'self' blob: data: https://open.spotify.com https://accounts.google.com https://challenges.cloudflare.com https://*.clerk.com https://*.clerk.accounts.dev https://clerk.litlabs.net https://*.github.io https://pacman.platzh1rsch.ch https://*.sudoku100.com https://minesweeper.github.io https://*.browserbase.com https://www.browserbase.com",
              "worker-src 'self' blob: https://litlabs.net https://www.litlabs.net https://cdn.emulatorjs.org https://v8.js-dos.com",
              "media-src 'self' blob: data:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self' https://*.clerk.com https://*.clerk.accounts.dev https://api.clerk.dev https://api.clerk.com https://js.clerk.dev",
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

  // The Clerk Frontend API proxy is now handled by Clerk's built-in
  // `frontendApiProxy` option in clerkMiddleware() (src/proxy.ts), NOT by a
  // manual Next.js rewrite. The previous rewrite forwarded /__clerk/* to
  // https://clerk.litlabs.net/*, which was broken (Cloudflare error 1000 —
  // DNS/proxy loop). Clerk's supported proxy forwards /__clerk/* to
  // frontend-api.clerk.dev with the required headers (Clerk-Proxy-Url,
  // Clerk-Secret-Key, X-Forwarded-For) and auto-derives the server-side
  // proxyUrl for the auth handshake. The browser side is configured via
  // NEXT_PUBLIC_CLERK_PROXY_URL (read by ClerkProvider in layout.tsx).
};

export default withSentryConfig(nextConfig, {
  // For more information, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/

  // Upload a larger set of source maps for more accurate stack traces.
  widenClientFileUpload: true,

  // Hides source maps from generated client bundles.
  hideSourceMaps: true,

  // Automatically tree-shake Sentry logger statements to reduce bundle size.
  disableLogger: true,
});
