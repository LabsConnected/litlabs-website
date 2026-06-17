import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { ThemeProvider } from "@/context/ThemeContext";
import { ProfileProvider } from "@/context/ProfileContext";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import CookieConsent from "@/components/CookieConsent";
import UserSync from "@/components/UserSync";
import AnimatedBackgroundWrapper from "@/components/AnimatedBackgroundWrapper";
import MusicPlayer from "@/components/MusicPlayer";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import { SITE_URL } from "@/lib/siteConfig";
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0d0d0d",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "LiTTree Lab Studios — AI Agent Platform",
    template: "%s | LiTTree Lab Studios",
  },
  description: "Deploy specialized AI agents, build no-code workflows, and automate your business with LiTTree Lab Studios — the AI-first creator platform.",
  keywords: ["AI agents", "automation", "workflow", "artificial intelligence", "NoCode", "LiTTree", "LiTPage", "Gemini", "AI platform"],
  authors: [{ name: "LiTTree Lab Studios", url: SITE_URL }],
  creator: "LiTTree Lab Studios",
  publisher: "LiTTree Lab Studios",
  robots: { index: true, follow: true, googleBot: { index: true, follow: true } },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "LiTTree Lab Studios",
    title: "LiTTree Lab Studios — AI Agent Platform",
    description: "Deploy specialized AI agents, build no-code workflows, and automate your business with LiTTree Lab Studios.",
    images: [{
      url: "/og-image.png",
      width: 1200,
      height: 630,
      alt: "LiTTree Lab Studios — AI Agent Platform",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "LiTTree Lab Studios — AI Agent Platform",
    description: "Deploy specialized AI agents, build no-code workflows, and automate your business.",
    creator: "@litlabs",
    images: ["/og-image.png"],
  },
  icons: {
    icon: [
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
    ],
  },
  manifest: '/manifest.json',
};

const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const inner = (
    <ThemeProvider>
      <ProfileProvider>
        <AnimatedBackgroundWrapper />
        <div className="relative z-10 flex flex-col min-h-screen">
          <UserSync />
          <Navbar />
          <main className="flex-1 mx-auto max-w-[100vw] overflow-x-hidden">{children}</main>
          <Footer />
          <MusicPlayer />
          <CookieConsent />
          <ServiceWorkerRegistration />
        </div>
      </ProfileProvider>
    </ThemeProvider>
  );

  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="antialiased min-h-screen" style={{ backgroundColor: "#0a0a0f" }}>
        {clerkKey ? (
          <ClerkProvider
            publishableKey={clerkKey}
            signInUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "/sign-in"}
            signUpUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL ?? "/sign-up"}
            signInFallbackRedirectUrl={process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL ?? "/studio"}
            signUpFallbackRedirectUrl={process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL ?? "/studio"}
            appearance={{
              variables: {
                colorPrimary: '#00f0ff',
                colorBackground: '#0a0a12',
                colorText: '#e0e0ff',
                colorTextSecondary: '#8888aa',
                colorDanger: '#ff00a0',
                colorSuccess: '#00ff41',
                borderRadius: '8px',
              },
              elements: {
                card: {
                  backgroundColor: '#151520',
                  border: '1px solid #2a2a45',
                  boxShadow: '0 4px 20px rgba(0,240,255,0.1)',
                },
                userButtonPopoverCard: {
                  backgroundColor: '#151520',
                  border: '1px solid #2a2a45',
                },
                userButtonPopoverActionButton: {
                  '&:hover': {
                    backgroundColor: 'rgba(0,240,255,0.1)',
                  },
                },
                badge: {
                  backgroundColor: '#ff00a0',
                },
              },
            }}
          >
            {inner}
          </ClerkProvider>
        ) : (
          inner
        )}
      </body>
    </html>
  );
}