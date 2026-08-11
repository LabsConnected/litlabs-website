/**
 * Service Offers Catalog — productized services sold on top of LiTTree.
 *
 * These are one-time service purchases (not SaaS subscriptions) that deliver
 * a bounded outcome: a launched site, a configured automation, or a brand kit.
 * Each service feeds into LiTTree for fulfillment and naturally converts buyers
 * into recurring SaaS subscribers.
 *
 * Pricing must match the GHL/Stripe product catalog exactly.
 * Stripe Payment Link env vars are referenced by name, never hardcoded.
 */

export type ServiceOfferId =
  | "launch_sprint"
  | "automation_setup"
  | "brand_pack";

export interface ServiceOffer {
  id: ServiceOfferId;
  name: string;
  tagline: string;
  description: string;
  /** Price in cents (USD) */
  priceCents: number;
  /** What's included in the deliverable */
  deliverables: string[];
  /** What's NOT included (scope boundaries) */
  exclusions: string[];
  /** Estimated turnaround */
  turnaround: string;
  /** Stripe Payment Link env var name (server-side only) */
  stripePaymentLinkEnv?: string;
  /** Whether this offer is currently available for purchase */
  enabled: boolean;
  /** Icon for display */
  icon: string;
  /** Accent color for cards */
  accent: string;
  /** Whether this is the featured/recommended offer */
  featured?: boolean;
}

export const SERVICE_OFFERS: Record<ServiceOfferId, ServiceOffer> = {
  launch_sprint: {
    id: "launch_sprint",
    name: "LiTTree Launch Sprint",
    tagline: "From idea to live site — fast",
    description:
      "We take your idea and get a real, polished website or landing page live. Includes design, build, deployment, and basic SEO setup.",
    priceCents: 44900,
    deliverables: [
      "Custom landing page or small website (up to 5 pages)",
      "Mobile-responsive design",
      "Deployment to your domain",
      "Basic SEO and meta tags",
      "Contact form or lead capture",
      "1 round of revisions",
    ],
    exclusions: [
      "Custom web applications or dashboards",
      "E-commerce or payment integration",
      "Ongoing maintenance (add a subscription for that)",
    ],
    turnaround: "5–7 business days",
    stripePaymentLinkEnv: "STRIPE_PAYMENT_LINK_LAUNCH_SPRINT",
    enabled: true,
    icon: "🚀",
    accent: "#a8ff2f",
    featured: true,
  },
  automation_setup: {
    id: "automation_setup",
    name: "AI Automation Setup",
    tagline: "CRM, Vapi, and lead routing — configured",
    description:
      "We set up your AI automation stack: GoHighLevel CRM configuration, Vapi voice agent, lead routing, and workflow automation.",
    priceCents: 89900,
    deliverables: [
      "GoHighLevel CRM setup and configuration",
      "Vapi voice agent integration",
      "Lead capture and routing workflows",
      "Appointment scheduling setup",
      "Email/SMS automation templates",
      "Webhook configuration",
      "1 round of revisions",
    ],
    exclusions: [
      "Custom n8n workflows beyond standard lead routing",
      "Third-party API integrations beyond scope",
      "Ongoing automation management",
    ],
    turnaround: "7–14 business days",
    stripePaymentLinkEnv: "STRIPE_PAYMENT_LINK_AUTOMATION_SETUP",
    enabled: true,
    icon: "⚙️",
    accent: "#65f4ff",
  },
  brand_pack: {
    id: "brand_pack",
    name: "Creator Brand Pack",
    tagline: "Brand direction, graphics, and social assets",
    description:
      "Get a cohesive brand identity: logo, color palette, typography, social media templates, and creative direction.",
    priceCents: 29900,
    deliverables: [
      "Logo design (primary + variations)",
      "Color palette and typography guide",
      "3 social media post templates",
      "Profile/banner graphics",
      "Brand direction document",
      "1 round of revisions",
    ],
    exclusions: [
      "Full website design (see Launch Sprint)",
      "Video or motion graphics",
      "Print materials",
    ],
    turnaround: "3–5 business days",
    stripePaymentLinkEnv: "STRIPE_PAYMENT_LINK_BRAND_PACK",
    enabled: true,
    icon: "🎨",
    accent: "#9b4dff",
  },
};

export const SERVICE_OFFER_LIST = Object.values(SERVICE_OFFERS);

export function getServiceOfferById(id: string): ServiceOffer | null {
  return SERVICE_OFFERS[id as ServiceOfferId] ?? null;
}

/**
 * Get the Stripe Payment Link URL from the environment variable.
 * Returns null if not configured.
 */
export function getServicePaymentLink(offer: ServiceOffer): string | null {
  if (!offer.stripePaymentLinkEnv) return null;
  const url = process.env[offer.stripePaymentLinkEnv];
  if (!url || !url.startsWith("https://")) return null;
  return url;
}

export function formatServicePrice(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}
