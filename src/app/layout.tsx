import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { ThemeProvider } from "@/context/ThemeContext";
import { ProfileProvider } from "@/context/ProfileContext";
import { WalletProvider } from "@/context/WalletContext";
import LayoutShell from "@/components/LayoutShell";
import { SITE_URL } from "@/lib/siteConfig";
import { GoogleTagManager } from "@next/third-parties/google";
import "./globals.css";

export const dynamic = "force-dynamic";

// Build-safe check for Clerk
const CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

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
  themeColor: "#0d0d0d",
};

const META_TITLE = "LiTTree LabStudios — The Creator Network With AI Agents";
const META_DESC =
  "Build, share, and grow with agents at your side. LiTTree is a creator network where AI helps you create, connect, and distribute your work.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: META_TITLE,
    template: "%s | LiTTree LabStudios",
  },
  description: META_DESC,
  keywords: [
    "creator network",
    "AI agents",
    "creators",
    "builders",
    "social distribution",
    "automation",
    "artificial intelligence",
    "NoCode",
    "LiTTree",
    "LiTPage",
    "AI platform",
  ],
  authors: [{ name: "LiTTree LabStudios", url: SITE_URL }],
  creator: "LiTTree LabStudios",
  publisher: "LiTTree LabStudios",
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "LiTTree LabStudios",
    title: META_TITLE,
    description: META_DESC,
    images: [
      {
        url: "/og-image.png",
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
    images: ["/og-image.png"],
  },
  icons: {
    icon: [
      { url: "/logo.webp", sizes: "192x192", type: "image/webp" },
      { url: "/logo.webp", sizes: "512x512", type: "image/webp" },
    ],
    apple: [
      { url: "/logo.webp", sizes: "192x192", type: "image/webp" },
    ],
  },
  manifest: "/manifest.json",
};

// Build-safe Clerk key check - only throw in runtime, not during build
const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const isBuildTime = process.env.NODE_ENV === "production" && process.env.NEXT_PHASE === "phase-production-build";

if (!clerkKey && !isBuildTime) {
  console.warn("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is not set. Auth features will be disabled.");
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const inner = (
    <ThemeProvider>
      <ProfileProvider>
        <WalletProvider>
          <LayoutShell>
            {children}
          </LayoutShell>
        </WalletProvider>
      </ProfileProvider>
    </ThemeProvider>
  );

  // If no Clerk key, render without ClerkProvider during build
  if (!clerkKey) {
    return (
      <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
        <GoogleTagManager gtmId="G-0G4JPF3HXG" />
        <body
          className="antialiased min-h-screen"
          style={{ backgroundColor: "#0a0a0f" }}
        >
          {inner}
        </body>
      </html>
    );
  }

  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <GoogleTagManager gtmId="G-0G4JPF3HXG" />
      <body
        className="antialiased min-h-screen"
        style={{ backgroundColor: "#0a0a0f" }}
      >
        <ClerkProvider
          publishableKey={clerkKey}
          signInUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "/sign-in"}
          signUpUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL ?? "/sign-up"}
          signInFallbackRedirectUrl={
            process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL ?? "/dashboard"
          }
          signUpFallbackRedirectUrl={
            process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL ?? "/dashboard?new=1"
          }
          appearance={{
            variables: {
              colorPrimary: "#00f0ff",
              colorBackground: "#0a0a12",
              colorText: "#e0e0ff",
              colorTextSecondary: "#8888aa",
              colorDanger: "#ff00a0",
              colorSuccess: "#00ff41",
              borderRadius: "8px",
            },
            elements: {
              card: {
                backgroundColor: "#151520",
                border: "1px solid #2a2a45",
                boxShadow: "0 4px 20px rgba(0,240,255,0.1)",
              },
              userButtonPopoverCard: {
                backgroundColor: "#151520",
                border: "1px solid #2a2a45",
              },
              userButtonPopoverActionButton: {
                "&:hover": {
                  backgroundColor: "rgba(0,240,255,0.1)",
                },
              },
              badge: {
                backgroundColor: "#ff00a0",
              },
            },
          }}
        >
          {inner}
        </ClerkProvider>
      </body>
    </html>
  );
}
