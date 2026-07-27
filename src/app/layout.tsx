import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { ClerkAuthContextProvider } from "@/context/ClerkAuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { ProfileProvider } from "@/context/ProfileContext";
import { WalletProvider } from "@/context/WalletContext";
import { VisualProvider } from "@/context/VisualContext";
import LayoutShell from "@/components/LayoutShell";
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  SITE_NAME,
  SITE_URL,
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

  icons: {
    icon: [
      { url: "/icon.png", type: "image/png" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-icon.png",
  },

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
  },

  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
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
            <LayoutShell>{children}</LayoutShell>
          </VisualProvider>
        </WalletProvider>
      </ProfileProvider>
    </ThemeProvider>
  );

  return (
    <html lang="en">
      <link
        rel="preconnect"
        href="https://clerk.litlabs.net"
        crossOrigin="anonymous"
      />
      <link rel="dns-prefetch" href="https://clerk.litlabs.net" />
      <body
        className="antialiased min-h-screen"
        style={{ backgroundColor: "#03050b" }}
      >
        {hasClerk ? (
          <ClerkProvider
            publishableKey={clerkKey!}
            signInUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "/sign-in"}
            signUpUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL ?? "/sign-up"}
            signInFallbackRedirectUrl={
              process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL ?? "/studio?tool=chat"
            }
            signUpFallbackRedirectUrl={
              process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL ?? "/studio?tool=chat"
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
              {shell}
            </ClerkAuthContextProvider>
          </ClerkProvider>
        ) : (
          <ClerkAuthContextProvider clerkAvailable={false}>
            {shell}
          </ClerkAuthContextProvider>
        )}
      </body>
    </html>
  );
}
