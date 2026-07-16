import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { ClerkAuthContextProvider } from "@/context/ClerkAuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { ProfileProvider } from "@/context/ProfileContext";
import { WalletProvider } from "@/context/WalletContext";
import { NavDrawerProvider } from "@/context/NavDrawerContext";
import LayoutShell from "@/components/LayoutShell";
import { SITE_URL } from "@/lib/siteConfig";
import { GoogleAnalytics } from "@next/third-parties/google";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import "./globals.css";

export const dynamic = "force-dynamic";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#1a1210",
};

const META_TITLE = "LiTTree-LabStudios — AI Agents for Creators";
const META_DESC =
  "Build, automate, and publish with an agent-powered creator operating system for studio work, workflows, marketplaces, and community.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: META_TITLE,
    template: "%s | LiTTree-LabStudios",
  },
  description: META_DESC,
  keywords: [
    "creator operating system",
    "AI agents",
    "creators",
    "builders",
    "AI workflow studio",
    "social distribution",
    "automation",
    "artificial intelligence",
    "NoCode",
    "LiTTree-LabStudios",
    "LiTLabs",
    "litlabs.net",
    "AI platform",
  ],
  authors: [{ name: "LiTTree-LabStudios", url: SITE_URL }],
  creator: "LiTTree-LabStudios",
  publisher: "LiTTree-LabStudios",
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "LiTTree-LabStudios",
    title: META_TITLE,
    description: META_DESC,
    images: [
      {
        url: "/og-image.webp",
        width: 1200,
        height: 630,
        alt: META_TITLE,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: META_TITLE,
    description: META_DESC,
    creator: "@litlabs",
    images: ["/og-image.webp"],
  },
  icons: {
    icon: [
      { url: "/logo.webp", sizes: "192x192", type: "image/webp" },
      { url: "/logo.webp", sizes: "512x512", type: "image/webp" },
    ],
    apple: [{ url: "/logo.webp", sizes: "192x192", type: "image/webp" }],
  },
  manifest: "/manifest.json",
};

const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const hasClerk = !!clerkKey && clerkKey.length > 10;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // FloatingChat is mounted inside LayoutShell which already has access to
  // the provider tree via context. LayoutShell suppresses it on /studio so
  // the Studio route manages its own voice/chat UI exclusively.
  const shell = (
    <ThemeProvider>
      <ProfileProvider>
        <WalletProvider>
          <NavDrawerProvider>
            <LayoutShell>{children}</LayoutShell>
          </NavDrawerProvider>
        </WalletProvider>
      </ProfileProvider>
    </ThemeProvider>
  );

  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <link
        rel="preconnect"
        href="https://accounts.dev"
        crossOrigin="anonymous"
      />
      <link
        rel="preconnect"
        href="https://clerk.litlabs.net"
        crossOrigin="anonymous"
      />
      <link
        rel="preconnect"
        href="https://static.cloudflareinsights.com"
        crossOrigin="anonymous"
      />
      <link rel="dns-prefetch" href="https://accounts.dev" />
      <link rel="dns-prefetch" href="https://clerk.litlabs.net" />
      <link rel="dns-prefetch" href="https://static.cloudflareinsights.com" />
      <GoogleAnalytics gaId="G-0G4JPF3HXG" />
      <body className="min-h-dvh overflow-x-clip antialiased">
        {hasClerk ? (
          <ClerkProvider
            publishableKey={clerkKey!}
            signInUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "/sign-in"}
            signUpUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL ?? "/sign-up"}
            signInFallbackRedirectUrl={
              process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL ?? "/studio"
            }
            signUpFallbackRedirectUrl={
              process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL ?? "/studio"
            }
            appearance={{
              variables: {
                colorPrimary: "#fbbf24",
                colorBackground: "#0a0a0f",
                colorText: "#f5e6c8",
                colorTextSecondary: "#a8916b",
                colorDanger: "#ef4444",
                colorSuccess: "#22c55e",
                borderRadius: "8px",
              },
              elements: {
                card: {
                  backgroundColor: "#1a1510",
                  border: "1px solid #3d3220",
                  boxShadow: "0 4px 20px rgba(251,191,36,0.1)",
                },
                userButtonPopoverCard: {
                  backgroundColor: "#1a1510",
                  border: "1px solid #3d3220",
                },
                userButtonPopoverActionButton: {
                  "&:hover": {
                    backgroundColor: "rgba(251,191,36,0.1)",
                  },
                },
                badge: {
                  backgroundColor: "#f59e0b",
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
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
