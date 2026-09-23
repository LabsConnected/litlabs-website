import type { Metadata } from "next";
import HomePageClient from "@/app/HomePageClient";
import { JsonLd } from "@/components/seo/JsonLd";
import {
  DEFAULT_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  absoluteUrl,
  buildMetadata,
} from "@/lib/seo";

// ISR — revalidate every 60s so CDN picks up new deploys without manual purge.
export const revalidate = 60;

export const metadata: Metadata = {
  ...buildMetadata({
    title: "LiTT — AI Project Operator & Creative Workspace",
    description:
      "LiTT plans, builds, edits real projects, uses tools, verifies work, and helps you ship from one workspace. Build apps, media, and workflows at litlabs.net.",
    path: "/",
    index: true,
  }),
  title: { absolute: "LiTT — AI Project Operator & Creative Workspace | LiTTree LabStudios" },
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
      description: DEFAULT_DESCRIPTION,
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
      description: DEFAULT_DESCRIPTION,
      publisher: {
        "@id": `${SITE_URL}/#organization`,
      },
      inLanguage: "en-US",
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#litt-application`,
      name: "LiTT",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      url: SITE_URL,
      description:
        "LiTT plans, builds, edits real projects, uses tools, verifies the work, and helps you ship—all from one workspace.",
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
            "Free forever. 500 AI credits (one-time), 1 active project.",
        },
        {
          "@type": "Offer",
          name: "Creator Beta",
          price: "15",
          priceCurrency: "USD",
          url: absoluteUrl("/pricing"),
          description:
            "Beta pricing. Research, write, and market with AI agents. 6,000 AI credits monthly, 5 active projects.",
        },
        {
          "@type": "Offer",
          name: "Pro Builder Beta",
          price: "39",
          priceCurrency: "USD",
          url: absoluteUrl("/pricing"),
          description:
            "Beta pricing. Build, debug, and deploy with full AI tooling. 20,000 AI credits monthly, 25 active projects.",
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
