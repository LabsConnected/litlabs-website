import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { ClerkAuthContextProvider } from "@/context/ClerkAuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { AuthorityJsonLd } from "@/components/seo/AuthorityJsonLd";
import { GhlAffiliateScript, GhlAffiliateSignupTracker } from "@/components/GhlAffiliateTracker";
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_OG_IMAGE,
  DEFAULT_TITLE,
  SITE_NAME,
  SITE_URL,
  absoluteUrl,
} from "@/lib/seo";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#03050b",
};

const googleVerification =
  process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),

  title: {
    default: DEFAULT_TITLE,
    template: `%s | ${SITE_NAME}`,
  },

  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,

  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,

  manifest: "/manifest.json",

  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },

  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: [
      {
        url: absoluteUrl(DEFAULT_OG_IMAGE),
        width: 1200,
        height: 630,
        alt: DEFAULT_TITLE,
      },
    ],
  },

  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: [absoluteUrl(DEFAULT_OG_IMAGE)],
  },

  verification: googleVerification
    ? {
        google: googleVerification,
      }
    : undefined,
};

// ClerkProvider must ALWAYS wrap the app so hooks like useSession/useUser
// don't crash with "can only be used within ClerkProvider". Previously this
// was conditional on NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY being present at build
// time — but if the key wasn't baked into the bundle during next build,
// the NoClerkAuth fallback was permanent, causing the live sign-in page to
// crash with "useSession can only be used within ClerkProvider".
//
// The Dockerfile now declares ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (and
// the other NEXT_PUBLIC_CLERK_* vars) so Railway injects them at build time,
// making the real pk_live key available to Next.js during SSG.
//
// When the key is absent (local builds without .env.local, CI without
// secrets), a clearly-fake placeholder is used so ClerkProvider doesn't
// throw "Missing publishableKey" during SSG. Auth calls will fail at
// runtime — which is the correct behavior when Clerk isn't configured.
// The real key always takes precedence when present.
//
// In production builds (NODE_ENV=production), a missing key throws a
// clear error instead of silently using the placeholder.
const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
if (!clerkKey && process.env.NODE_ENV === "production" && !process.env.SKIP_CLERK_CHECK) {
  console.error("✗ Clerk configuration missing — set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
}
const resolvedClerkKey = clerkKey || "pk_test_YnVpbGQtcGxhY2Vob2xkZXIubG9jYWwk";

// Force dynamic rendering so ClerkProvider doesn't throw during static
// prerendering when the Clerk key is missing (local builds, CI without
// secrets). The app is inherently dynamic (Clerk auth, user state) so
// static prerendering provides no benefit here.
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const shell = (
    <ThemeProvider>{children}</ThemeProvider>
  );

  return (
    <html lang="en">
      <head>{/* Clerk Frontend API is proxied via /__clerk (server-side).
             The browser loads Clerk JS through the same-origin proxy,
             which forwards to clerk.litlabs.net with Cloudflare headers
             stripped to avoid Error 1000. */}</head>
      <body
        className="antialiased min-h-dvh"
        style={{ backgroundColor: "#03050b" }}
        suppressHydrationWarning
      >
        <GhlAffiliateScript />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[9999] focus:rounded-lg focus:bg-cyan-400 focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-slate-950"
        >
          Skip to main content
        </a>
        <ClerkProvider
          publishableKey={resolvedClerkKey}
          // The /__clerk proxy is handled server-side by handleClerkProxy()
          // in src/proxy.ts. It forwards to clerk.litlabs.net with Cloudflare
          // infrastructure headers stripped to prevent Error 1000.
          signInUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || "/sign-in"}
          signUpUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL || "/sign-up"}
          signInFallbackRedirectUrl={
            process.env.NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL ||
            "/studio"
          }
          signUpFallbackRedirectUrl={
            process.env.NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL ||
            "/studio"
          }
          appearance={{
            variables: {
              colorPrimary: "#a970ff",
              colorBackground: "#060914",
              colorForeground: "#eef4ff",
              colorMutedForeground: "#9ba7c7",
              colorDanger: "#ef4444",
              colorSuccess: "#22c55e",
              borderRadius: "8px",
            },
            elements: {
              card: {
                backgroundColor: "#090d1b",
                border: "1px solid #29345e",
                boxShadow: "0 24px 70px rgba(0,0,0,.55), 0 0 38px rgba(169,112,255,.12)",
              },
              userButtonPopoverCard: {
                backgroundColor: "#0b1020",
                border: "1px solid #3b4773",
                boxShadow: "0 24px 70px rgba(0,0,0,.68), 0 0 42px rgba(169,112,255,.18)",
              },
              userButtonPopoverActionButton: {
                color: "#eef4ff",
                fontWeight: "600",
                minHeight: "44px",
                "&:hover": {
                  color: "#ffffff",
                  backgroundColor: "rgba(169,112,255,0.2)",
                },
              },
              userButtonPopoverActionButtonText: {
                color: "#eef4ff",
              },
              userButtonPopoverActionButtonIcon: {
                color: "#c4b5fd",
              },
              userPreviewMainIdentifier: {
                color: "#ffffff",
                fontWeight: "700",
              },
              userPreviewSecondaryIdentifier: {
                color: "#b7c2df",
              },
              userButtonPopoverFooter: {
                backgroundColor: "#080c18",
                borderTop: "1px solid #29345e",
              },
              badge: {
                backgroundColor: "#a970ff",
              },
            },
          }}
        >
          <ClerkAuthContextProvider clerkAvailable={true}>
            <GhlAffiliateSignupTracker />
            <AuthorityJsonLd />
            {shell}
          </ClerkAuthContextProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
