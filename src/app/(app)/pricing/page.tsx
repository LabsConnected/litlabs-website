import PricingClient from "./PricingClient";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Pricing",
  description: "Simple, transparent pricing for creators and builders at LiTTree LabStudios.",
  path: "/pricing",
});

export default function PricingPage() {
  // The Founding Member tier is retired, so STRIPE_PRICE_FOUNDER is no longer
  // consulted here. It previously gated the $149 card, and because it IS set
  // in the production environment the card rendered with a live
  // "Become a Founding Member" button.
  return <PricingClient />;
}
