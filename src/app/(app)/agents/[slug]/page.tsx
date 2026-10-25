export const dynamicParams = false;

// Requests are rewritten to /agent-slug/[slug] before this page renders, so
// the HTTP status is decided outside the root loading boundary. This module
// still calls notFound()/redirect() for direct renders and tests.

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isKnownAgentSlug, knownAgentSlugs } from "@/lib/agent-slug";

type AgentSlugProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return knownAgentSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: AgentSlugProps): Promise<Metadata> {
  const { slug } = await params;
  if (!isKnownAgentSlug(slug)) notFound();
  return {
    robots: { index: false, follow: false },
  };
}

export default async function AgentPage({ params }: AgentSlugProps) {
  const { slug } = await params;
  if (!isKnownAgentSlug(slug)) notFound();
  redirect("/studio?tool=workflows");
}
