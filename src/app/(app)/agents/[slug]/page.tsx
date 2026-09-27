export const dynamic = "force-dynamic";
export const dynamicParams = false;

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
