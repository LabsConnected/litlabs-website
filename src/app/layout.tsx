import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { ThemeProvider } from "@/context/ThemeContext";
import { ProfileProvider } from "@/context/ProfileContext";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import CookieConsent from "@/components/CookieConsent";
import UserSync from "@/components/UserSync";
import AnimatedBackgroundWrapper from "@/components/AnimatedBackgroundWrapper";
import "./globals.css";

export const metadata: Metadata = {
  title: "LiTTree Lab Studios — AI Agent Platform",
  description: "LiTPage — Your AI Universe. Deploy specialized AI agents, build workflows, and dominate your niche.",
  keywords: ["AI agents", "automation", "workflow", "artificial intelligence", "NoCode", "LiTTree", "LiTPage"],
  authors: [{ name: "LiTTree Lab Studios" }],
  creator: "LiTTree Lab Studios",
  publisher: "LiTTree Lab Studios",
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://litlabs.net",
    siteName: "LiTTree Lab Studios",
    title: "LiTTree Lab Studios — AI Agent Platform",
    description: "LiTPage — Your AI Universe. Deploy agents. Automate workflows. Dominate your niche.",
  },
  twitter: {
    card: "summary_large_image",
    title: "LiTTree Lab Studios — AI Agent Platform",
    description: "LiTPage — Your AI Universe. Deploy agents. Automate workflows. Dominate your niche.",
    creator: "@litlabs",
  },
  verification: {
    google: "verify-later",
  },
};

const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
const clerkReady =
  (clerkKey.startsWith("pk_test_") || clerkKey.startsWith("pk_live_")) &&
  clerkKey.length > 40;

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
          <main className="flex-1">{children}</main>
          <Footer />
          <CookieConsent />
        </div>
      </ProfileProvider>
    </ThemeProvider>
  );

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=VT323&family=Orbitron:wght@400;500;600;700;800;900&family=Press+Start+2P&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased min-h-screen" style={{ backgroundColor: "#0a0a0f" }}>
        {clerkReady ? (
          <ClerkProvider>
            {inner}
          </ClerkProvider>
        ) : (
          <>
            {inner}
          </>
        )}
      </body>
    </html>
  );
}