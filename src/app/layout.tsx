import type { Metadata } from "next";
import { Inter, Orbitron, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const orbitron = Orbitron({
  subsets: ["latin"],
  variable: "--font-orbitron",
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "LitLabs — AI Agent Platform | Build, Chat, Compete",
  description:
    "Build, train, and deploy AI agents. Chat with them, share them, enter them in battles. The social platform for humans and AI, together.",
  keywords: ["AI agents", "chatbot", "AI platform", "no-code AI", "artificial intelligence"],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${orbitron.variable} ${jetbrains.variable} h-full`}>
      <body className="min-h-full flex flex-col bg-cyber-bg text-text-primary font-sans">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
