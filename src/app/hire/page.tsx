import { Metadata } from "next";
import { SERVICE_OFFER_LIST, formatServicePrice } from "@/config/service-offers";
import HireClient from "./HireClient";

export const metadata: Metadata = {
  title: "Hire LiTTree LabStudios — Launch Sprint, Automation, Brand",
  description:
    "Get it done for you. Productized AI services: website launch, automation setup, and brand packs. Bounded scope, clear pricing, fast delivery.",
  openGraph: {
    title: "Hire LiTTree LabStudios",
    description:
      "From idea to live site, AI automation, or brand identity — we do it for you.",
  },
};

export default async function HirePage() {
  // Resolve Stripe Payment Links server-side for each offer.
  // If a link isn't configured, the button shows "Coming soon".
  const offers = SERVICE_OFFER_LIST.map((offer) => {
    let paymentLink: string | null = null;
    try {
      const url = process.env[offer.stripePaymentLinkEnv ?? ""];
      if (url && url.startsWith("https://")) {
        paymentLink = url;
      }
    } catch {
      // ignore
    }
    return {
      id: offer.id,
      name: offer.name,
      tagline: offer.tagline,
      description: offer.description,
      price: formatServicePrice(offer.priceCents),
      deliverables: offer.deliverables,
      exclusions: offer.exclusions,
      turnaround: offer.turnaround,
      icon: offer.icon,
      accent: offer.accent,
      featured: offer.featured ?? false,
      enabled: offer.enabled,
      paymentLink,
    };
  });

  return <HireClient offers={offers} />;
}
