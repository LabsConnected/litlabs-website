import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import { getPublicMarketplaceItemBySlug } from "@/lib/public-marketplace";
import CapabilityDetailClient from "./CapabilityDetailClient";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  let item: Awaited<ReturnType<typeof getPublicMarketplaceItemBySlug>>;
  try {
    item = await getPublicMarketplaceItemBySlug(slug);
  } catch {
    // Transient catalog failure — keep the page self-canonical and
    // indexable; the client will still render or retry.
    return buildMetadata({ title: "Marketplace", path: `/marketplace/${slug}` });
  }
  if (!item) {
    return buildMetadata({
      title: "Item Not Found",
      path: `/marketplace/${slug}`,
      index: false,
    });
  }
  return buildMetadata({
    title: `${item.name} — Marketplace`,
    description: item.description ?? undefined,
    path: `/marketplace/${item.slug}`,
    index: true,
  });
}

export default async function CapabilityDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <CapabilityDetailClient slug={slug} />;
}
