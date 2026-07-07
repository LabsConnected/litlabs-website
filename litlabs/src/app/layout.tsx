import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { ThemeProvider } from "@/context/ThemeContext";
import { ProfileProvider } from "@/context/ProfileContext";
import { WalletProvider } from "@/context/WalletContext";
import LayoutShell from "@/components/LayoutShell";
import { SITE_URL } from "@/lib/siteConfig";
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
  themeColor: "#08080c",
};

const META_TITLE = "LiTTree OS — The AI Operating System for Creators";
const META_DESC =
  "Chat, code, create, deploy agents, play games, and collaborate — all in one AI OS. Build with specialist agents, ship with Studio, sell in the Marketplace.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: META_TITLE,
    template: "%s | LiTTree OS",
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
    "LiTTree",
    "LiTPage",
    "AI platform",
    "LiTTree OS",
    "AI games",
    "agent marketplace",
    "creator AI tools",
  ],
  authors: [{ name: "LiTTree Lab Studios", url: SITE_URL }],
  creator: "LiTTree Lab Studios",
  publisher: "LiTTree Lab Studios",
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "LiTTree OS",
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
    apple: [
      { url: "/logo.webp", sizes: "192x192", type: "image/webp" },
    ],
  },
  manifest: "/manifest.json",
};

const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const shell = (
    <ThemeProvider>
      <ProfileProvider>
        <WalletProvider>
          <LayoutShell>{children}</LayoutShell>
        </WalletProvider>
      </ProfileProvider>
    </ThemeProvider>
  );

  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body
        className="antialiased min-h-screen"
        style={{ backgroundColor: "#08080c" }}
      >
        {clerkKey ? (
          <ClerkProvider
            publishableKey={clerkKey}
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
            {shell}
          </ClerkProvider>
        ) : (
          shell
        )}
      </body>
    </html>
  );
}
