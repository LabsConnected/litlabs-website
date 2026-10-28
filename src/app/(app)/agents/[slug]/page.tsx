import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isKnownAgentSlug, KNOWN_AGENT_SLUGS } from "@/lib/agent-public-slug";

export const dynamic = "force-dynamic";

// Unknown slugs are rewritten to a missing path in next.config before this
// page renders. These guards cover direct renders and metadata.
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
