import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { ClerkAuthContextProvider } from "@/context/ClerkAuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { ProfileProvider } from "@/context/ProfileContext";
import { WalletProvider } from "@/context/WalletContext";
import { VisualProvider } from "@/context/VisualContext";
import { YouTubePlayerProvider } from "@/context/YouTubePlayerContext";
import { MediaHubProvider } from "@/components/media/MediaHubProvider";
import { MusicPlayerProvider } from "@/context/MusicPlayerContext";
import LayoutShell from "@/components/LayoutShell";
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

const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const hasClerk = !!clerkKey && clerkKey.length > 10;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const shell = (
    <ThemeProvider>
      <ProfileProvider>
        <WalletProvider>
          <VisualProvider>
            <MediaHubProvider>
              <YouTubePlayerProvider>
                <MusicPlayerProvider>
                  <LayoutShell>{children}</LayoutShell>
                </MusicPlayerProvider>
              </YouTubePlayerProvider>
            </MediaHubProvider>
          </VisualProvider>
        </WalletProvider>
      </ProfileProvider>
    </ThemeProvider>
  );

  return (
    <html lang="en">
      <head>
        <link
          rel="preconnect"
          href="https://clerk.litlabs.net"
          crossOrigin="anonymous"
        />
        <link rel="dns-prefetch" href="https://clerk.litlabs.net" />
      </head>
      <body
        className="antialiased min-h-screen"
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
        {hasClerk ? (
          <ClerkProvider
            publishableKey={clerkKey!}
            signInUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "/sign-in"}
            signUpUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL ?? "/sign-up"}
            signInFallbackRedirectUrl={
              process.env.NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL ??
              "/dashboard"
            }
            signUpFallbackRedirectUrl={
              process.env.NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL ??
              "/dashboard"
            }
            appearance={{
              variables: {
                colorPrimary: "#a970ff",
                colorBackground: "#060914",
                colorText: "#eef4ff",
                colorTextSecondary: "#9ba7c7",
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
        ) : (
          <ClerkAuthContextProvider clerkAvailable={false}>
            <AuthorityJsonLd />
            {shell}
          </ClerkAuthContextProvider>
        )}
      </body>
    </html>
  );
}
