import type { NextConfig } from "next";

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

  experimental: {
    optimizePackageImports: [
      "@supabase/supabase-js",
      "lucide-react",
      "@clerk/nextjs",
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
              "geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()",
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
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.clerk.com https://clerk.litlabs.net https://*.clerk.accounts.dev https://js.clerk.dev https://accounts.google.com https://www.googletagmanager.com https://challenges.cloudflare.com https://cdn-cgi.cloudflare.com https://static.cloudflareinsights.com https://litlabs.net https://vercel.live",
              "script-src-elem 'self' 'unsafe-inline' 'unsafe-eval' https://*.clerk.com https://clerk.litlabs.net https://*.clerk.accounts.dev https://js.clerk.dev https://accounts.google.com https://www.googletagmanager.com https://challenges.cloudflare.com https://cdn-cgi.cloudflare.com https://static.cloudflareinsights.com https://litlabs.net https://vercel.live",
              "script-src-attr 'none'",
              "style-src 'self' 'unsafe-inline' https://*.clerk.com",
              "img-src 'self' data: blob: https://images.unsplash.com https://*.supabase.co https://image.pollinations.ai https://img.clerk.com https://images.clerk.dev https://fal.media https://storage.googleapis.com https://img.youtube.com https://*.googleusercontent.com https://lh3.googleusercontent.com https://avatars.githubusercontent.com https://upload.wikimedia.org https://placehold.co",
              "font-src 'self' https://*.clerk.com",
              "connect-src 'self' https://*.clerk.com https://*.clerk.accounts.dev https://api.clerk.dev https://clerk.litlabs.net https://*.supabase.co wss://*.supabase.co https://api.openai.com https://openrouter.ai https://api.stripe.com https://fal.run https://fal.ai wss://*.fal.run https://image.pollinations.ai https://cloud.activepieces.com https://api.minimax.chat https://together.xyz https://api.together.xyz https://cloudflareinsights.com https://litlabs.net",
              "frame-src 'self' https://open.spotify.com https://js.stripe.com https://accounts.google.com https://challenges.cloudflare.com https://*.clerk.com https://*.clerk.accounts.dev https://*.github.io https://pacman.platzh1rsch.ch https://*.sudoku100.com https://minesweeper.github.io",
              "worker-src 'self' blob: https://litlabs.net",
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
      // Prevent caching of HTML pages (force fresh content)
      {
        source: "/:path*",
        headers: [
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
      {
        source: "/agent-chat",
        destination: "/agent",
        permanent: false,
      },
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
