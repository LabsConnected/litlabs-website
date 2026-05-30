import type { Metadata } from "next";
import { Inter, Orbitron, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";

// Optimized: reduced weights to cut font payload by ~60%
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["400", "600"], // was: default (all weights)
  preload: true,
});

const orbitron = Orbitron({
  subsets: ["latin"],
  variable: "--font-orbitron",
  display: "swap",
  weight: ["700", "900"], // was: 400-900 (all 6 weights)
  preload: true,
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
  weight: ["400", "700"], // was: 400-700 (all 4 weights)
  preload: true,
});

export const metadata: Metadata = {
  title: "LiTTreeLabstudios | The LitLabs Autonomous Media & Social Engine",
  description:
    "Step into a limitless digital hub. LiTTreeLabstudios fuses a massive, Kodi-style media experience with an advanced AI social network powered by the litlabs.net ecosystem. Build, automate, and stream using custom Homebase-3.0 cyber-daemons, dual-agent orchestration (Director & Executor), and CEO OPERATING SYSTEM v3.0 workflows within a high-energy, immersive environment.",
  authors: [{ name: "Larry Bol" }],
  keywords: [
    "LiTTreeLabstudios",
    "LitLabs",
    "Homebase-3.0",
    "AI social network",
    "cyber-daemons",
    "Director & Executor",
    "CEO OPERATING SYSTEM",
    "media engine",
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${orbitron.variable} ${jetbrains.variable} h-full`}
    >
      <body className="min-h-full flex flex-col bg-cyber-bg text-text-primary font-sans">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
