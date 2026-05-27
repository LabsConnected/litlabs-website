import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";

export const metadata: Metadata = {
  title: "LiTree Lab Studio — AI-Native Workspace Platform",
  description: "Premium command surface for live AI ops, social automation, and production telemetry.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col bg-cyber-bg text-text-primary">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
