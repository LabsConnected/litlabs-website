import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk, Sora, Pixelify_Sans, Orbitron, Press_Start_2P, Chakra_Petch, Rajdhani } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { ClerkAuthContextProvider } from "@/context/ClerkAuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { ProfileProvider } from "@/context/ProfileContext";
import { WalletProvider } from "@/context/WalletContext";
import { VisualProvider } from "@/context/VisualContext";
import LayoutShell from "@/components/LayoutShell";
import { SITE_URL } from "@/lib/siteConfig";
import { GoogleAnalytics } from "@next/third-parties/google";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import "./globals.css";

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

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  display: "swap",
});

const pixelifySans = Pixelify_Sans({
  subsets: ["latin"],
  variable: "--font-pixelify-sans",
  display: "swap",
});

const orbitron = Orbitron({
  subsets: ["latin"],
  variable: "--font-orbitron",
  display: "swap",
});

const pressStart2P = Press_Start_2P({
  subsets: ["latin"],
  variable: "--font-press-start-2p",
  display: "swap",
  weight: ["400"],
});

const chakraPetch = Chakra_Petch({
  subsets: ["latin"],
  variable: "--font-chakra-petch",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const rajdhani = Rajdhani({
  subsets: ["latin"],
  variable: "--font-rajdhani",
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#03050b",
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
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} ${spaceGrotesk.variable} ${sora.variable} ${pixelifySans.variable} ${orbitron.variable} ${pressStart2P.variable} ${chakraPetch.variable} ${rajdhani.variable}`}>
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
              process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL ?? "/studio"
            }
            signUpFallbackRedirectUrl={
              process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL ?? "/studio"
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
                  backgroundColor: "#090d1b",
                  border: "1px solid #29345e",
                },
                userButtonPopoverActionButton: {
                  "&:hover": {
                    backgroundColor: "rgba(169,112,255,0.12)",
                  },
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
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
