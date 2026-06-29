import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Code Scanner",
  description: "AI-powered code analysis and review. Scan your codebase for issues and improvements.",
};

export default function CodeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
