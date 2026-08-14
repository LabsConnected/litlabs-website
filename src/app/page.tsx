import type { Metadata } from "next";
import { JsonLd } from "@/components/seo/JsonLd";
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  SITE_NAME,
  SITE_URL,
  absoluteUrl,
  buildMetadata,
} from "@/lib/seo";
import { LandingHeader } from "./landing/_components/LandingHeader";
import { LandingHeroV3 } from "./landing/_components/LandingHeroV3";
import { LandingOneContext } from "./landing/_components/LandingOneContext";
import { LandingLogos } from "./landing/_components/LandingLogos";
import { LandingComparison } from "./landing/_components/LandingComparison";
import { LandingHowItWorks } from "./landing/_components/LandingHowItWorks";
import { LandingFeatures } from "./landing/_components/LandingFeatures";
import { LandingTreeOS } from "./landing/_components/LandingTreeOS";
import { LandingStats } from "./landing/_components/LandingStats";
import { LandingCTA } from "./landing/_components/LandingCTA";
import { LandingFooter } from "./landing/_components/LandingFooter";
import { LandingBackground } from "./landing/_components/LandingBackground";

export const metadata: Metadata = {
  ...buildMetadata({
    title: "Bring the idea. LiTT helps you build the rest.",
    description:
      "Build apps, create media, preserve project context, collaborate and ship real work from Studio. Free to join.",
    path: "/",
    index: true,
  }),
  title: { absolute: "Bring the idea. LiTT helps you build the rest. | LiTTree LabStudios" },
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
        "https://x.com/LitLabsNet",
        "https://www.instagram.com/litlabsnet",
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
  ],
};

export default function HomePage() {
  return (
    <>
      <JsonLd data={homeSchema} />
      <div className="relative min-h-screen overflow-x-hidden bg-[#06060e] text-neutral-100">
        <LandingBackground />
        <LandingHeader />
        <main className="relative z-10">
          <LandingHeroV3 />
          <LandingOneContext />
          <LandingLogos />
          <LandingComparison />
          <LandingHowItWorks />
          <LandingFeatures />
          <LandingTreeOS />
          <LandingStats />
          <LandingCTA />
        </main>
        <LandingFooter />
      </div>
    </>
  );
}
