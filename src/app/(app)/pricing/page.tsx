import PricingClient from "./PricingClient";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Pricing",
  description: "Simple, transparent pricing for creators, builders, and founders at LiTTree LabStudios.",
  path: "/pricing",
});

export default function PricingPage() {
  const founderAvailable = !!process.env.STRIPE_PRICE_FOUNDER;
  return <PricingClient founderAvailable={founderAvailable} />;
}
