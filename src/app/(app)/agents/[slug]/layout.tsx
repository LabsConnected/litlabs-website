import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isKnownAgentSlug } from "@/lib/agent-public-slug";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AgentSlugLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // Outside the page's loading boundary so an unknown slug is a real 404
  // rather than a 200 shell that says the page is missing.
  if (!isKnownAgentSlug(slug)) notFound();
  return children;
}
