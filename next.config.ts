import type { NextConfig } from "next";

const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.clerk.com https://clerk.litlabs.net https://*.clerk.accounts.dev https://js.clerk.dev https://accounts.google.com https://www.googletagmanager.com https://challenges.cloudflare.com https://cdn-cgi.cloudflare.com https://static.cloudflareinsights.com https://litlabs.net https://vercel.live https://*.vercel.app https://cdn.emulatorjs.org",
  "script-src-elem 'self' 'unsafe-inline' 'unsafe-eval' https://*.clerk.com https://clerk.litlabs.net https://*.clerk.accounts.dev https://js.clerk.dev https://accounts.google.com https://www.googletagmanager.com https://challenges.cloudflare.com https://cdn-cgi.cloudflare.com https://static.cloudflareinsights.com https://litlabs.net https://vercel.live https://*.vercel.app https://cdn.emulatorjs.org",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline' https://*.clerk.com https://cdn.emulatorjs.org",
  "img-src 'self' data: blob: https://images.unsplash.com https://*.supabase.co https://image.pollinations.ai https://img.clerk.com https://images.clerk.dev https://fal.media https://*.fal.media https://storage.googleapis.com https://img.youtube.com https://*.googleusercontent.com https://lh3.googleusercontent.com https://avatars.githubusercontent.com https://upload.wikimedia.org https://placehold.co https://vercel.com https://vercel.live https://*.vercel.app https://cdn.emulatorjs.org",
  "font-src 'self' data: https://*.clerk.com https://cdn.emulatorjs.org",
  "connect-src 'self' blob: data: https://*.clerk.com https://*.clerk.accounts.dev https://api.clerk.dev https://clerk.litlabs.net https://clerk-telemetry.com https://*.clerk-telemetry.com https://*.supabase.co wss://*.supabase.co https://api.openai.com https://openrouter.ai https://api.stripe.com https://fal.run https://fal.ai https://*.fal.run wss://*.fal.run https://image.pollinations.ai https://cloud.activepieces.com https://api.minimax.chat https://together.xyz https://api.together.xyz https://cloudflareinsights.com https://*.cloudflareinsights.com https://litlabs.net https://*.up.railway.app wss://*.up.railway.app https://vercel.live https://*.vercel.app https://cdn.emulatorjs.org https://www.google-analytics.com https://*.google-analytics.com",
  "frame-src 'self' data: blob: https://open.spotify.com https://js.stripe.com https://accounts.google.com https://challenges.cloudflare.com https://*.clerk.com https://*.clerk.accounts.dev https://*.github.io https://pacman.platzh1rsch.ch https://*.sudoku100.com https://minesweeper.github.io https://cdn.emulatorjs.org",
  "worker-src 'self' blob: data: https://litlabs.net https://cdn.emulatorjs.org",
  "media-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://*.clerk.com https://*.clerk.accounts.dev",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

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
      "@monaco-editor/react",
      "stripe",
      "supermemory",
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
      { source: "/builder", destination: "/studio", permanent: true },
      {
        source: "/generate",
        destination: "/studio?tool=image",
        permanent: false,
      },
      { source: "/flow", destination: "/studio?tool=flow", permanent: false },
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
