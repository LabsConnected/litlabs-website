import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { isKnownAgentSlug } from "@/lib/agent-slug";

/**
 * The slug check lives in this layout, outside the segment loading.tsx
 * boundary, so an unknown slug is a real HTTP 404 instead of a streamed 200.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isKnownAgentSlug(slug)) notFound();
  return {
    robots: { index: false, follow: false },
  };
}

export default async function AgentSlugLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isKnownAgentSlug(slug)) notFound();
  return children;
}
