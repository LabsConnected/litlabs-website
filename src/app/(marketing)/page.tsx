import type { Metadata } from "next";
import HomePageClient from "@/app/HomePageClient";
import { JsonLd } from "@/components/seo/JsonLd";
import {
  SITE_NAME,
  SITE_URL,
  absoluteUrl,
  buildMetadata,
} from "@/lib/seo";
import {
  formatBits,
  getPlanCreditAllowance,
} from "@/config/plan-entitlements";

// ISR — revalidate every 60s so CDN picks up new deploys without manual purge.
export const revalidate = 60;

export const metadata: Metadata = {
  ...buildMetadata({
    title: "LiTT — AI Project Operator",
    description:
      "LiTT is your AI Project Operator. It plans work, builds and edits real files, verifies results, and helps you prepare projects to ship.",
    path: "/",
    index: true,
  }),
  title: { absolute: "LiTT — AI Project Operator | LiTTree LabStudios · litlabs.net" },
};

const homeSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      alternateName: [
        "LitLabs",
        "Lit Labs",
        "LiTTree",
        "LiTTree Labs",
        "LiTTree LabStudio",
        "LiTT Labs",
        "litlabs.net",
      ],
      url: SITE_URL,
      telephone: "+1-231-428-5411",
      address: {
        "@type": "PostalAddress",
        streetAddress: "17082 Ontario Dr",
        addressLocality: "Spring Lake",
        addressRegion: "MI",
        postalCode: "49456",
        addressCountry: "US",
      },
      sameAs: [
        "https://github.com/LabsConnected",
        "https://www.youtube.com/@LiTTreeLabStudios",
        "https://www.linkedin.com/company/litlabs",
      ],
      logo: {
        "@type": "ImageObject",
        url: absoluteUrl("/icon-512.png"),
        width: 512,
        height: 512,
      },
      image: absoluteUrl("/opengraph-image.png"),
      description: "LiTTree LabStudios is the company behind LiTT, an AI Project Operator for planning, building, and verifying real projects in one workspace.",
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      alternateName: [
        "LitLabs",
        "Lit Labs",
        "LiTTree",
        "LiTTree Labs",
        "litlabs.net",
      ],
      publisher: {
        "@id": `${SITE_URL}/#organization`,
      },
      inLanguage: "en-US",
      description: "LiTT is an AI Project Operator for planning, building, and verifying projects in one workspace.",
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#litt-application`,
      name: "LiTT",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      url: SITE_URL,
      description:
        "LiTT is an AI Project Operator for planning, building, and verifying projects in one workspace.",
      publisher: {
        "@id": `${SITE_URL}/#organization`,
      },
      offers: [
        {
          "@type": "Offer",
          name: "Starter",
          price: "0",
          priceCurrency: "USD",
          url: absoluteUrl("/pricing"),
          description:
            `Free forever. ${formatBits(getPlanCreditAllowance("starter"))} LiTTBits (one-time), 1 active project.`,
        },
        {
          "@type": "Offer",
          name: "Creator Lite",
          price: "9.99",
          priceCurrency: "USD",
          url: absoluteUrl("/pricing"),
          description:
            "Entry paid tier — creator tools at a lower price. 3 active projects.",
        },
        {
          "@type": "Offer",
          name: "Creator",
          price: "19.99",
          priceCurrency: "USD",
          url: absoluteUrl("/pricing"),
          description:
            `Research, write, and market with AI agents. ${formatBits(getPlanCreditAllowance("creator_beta"))} LiTTBits monthly, 5 active projects.`,
        },
        {
          "@type": "Offer",
          name: "Pro Builder",
          price: "39",
          priceCurrency: "USD",
          url: absoluteUrl("/pricing"),
          description:
            `Build, debug, and deploy with full AI tooling. ${formatBits(getPlanCreditAllowance("pro_builder_beta"))} LiTTBits monthly, 25 active projects.`,
        },
      ],
    },
  ],
};

export default function HomePage() {
  return (
    <>
      <JsonLd data={homeSchema} />
      <HomePageClient />
    </>
  );
}
