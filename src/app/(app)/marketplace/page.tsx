import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import { getPublicMarketplaceItems } from "@/lib/public-marketplace";
import MarketplaceClient, { type MarketplaceItem } from "./MarketplaceClient";

export const metadata: Metadata = buildMetadata({ title: "Marketplace", description: "Browse LiTT capabilities, tools, workflows, and integrations. Installation availability is shown for each item.", path: "/marketplace", index: true });

export default async function MarketplacePage() {
  let items: MarketplaceItem[] = [];
  let initialError = false;
  try {
    items = await getPublicMarketplaceItems();
  } catch {
    initialError = true;
  }
  return <MarketplaceClient initialItems={items} initialError={initialError} />;
}
