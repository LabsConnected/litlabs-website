export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isKnownAgentSlug, KNOWN_AGENT_SLUGS } from "@/lib/agent-public-slug";

// Unknown slugs never match a generated param, so Next answers with the
// app not-found page (HTTP 404) before this module renders.
export const dynamicParams = false;

export function generateStaticParams() {
  return KNOWN_AGENT_SLUGS.map((slug) => ({ slug }));
}

type AgentSlugPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: AgentSlugPageProps): Promise<Metadata> {
  const { slug } = await params;
  if (!isKnownAgentSlug(slug)) notFound();
  return {
    robots: { index: false, follow: false },
  };
}

export default async function AgentPage({ params }: AgentSlugPageProps) {
  const { slug } = await params;
  if (!isKnownAgentSlug(slug)) notFound();
  redirect("/studio?tool=workflows");
}
