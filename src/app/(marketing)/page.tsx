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
import { LandingHeader } from "@/app/landing/_components/LandingHeader";
import { LandingHeroV3 } from "@/app/landing/_components/LandingHeroV3";
import { LandingMissionProof } from "@/app/landing/_components/LandingMissionProof";
import { LandingProductCards } from "@/app/landing/_components/LandingProductCards";
import { LandingStudioFlow } from "@/app/landing/_components/LandingStudioFlow";
import { LandingHowItWorks } from "@/app/landing/_components/LandingHowItWorks";
import { LandingBuiltWithLiTT } from "@/app/landing/_components/LandingBuiltWithLiTT";
import { LandingTrust } from "@/app/landing/_components/LandingTrust";
import { LandingPricing } from "@/app/landing/_components/LandingPricing";
import { LandingRoadmap } from "@/app/landing/_components/LandingRoadmap";
import { LandingCTA } from "@/app/landing/_components/LandingCTA";
import { LandingFooter } from "@/app/landing/_components/LandingFooter";
import { LandingBackground } from "@/app/landing/_components/LandingBackground";
import { LandingScrollReveal } from "@/app/landing/_components/LandingScrollReveal";

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
        <main id="main-content" className="relative z-10">
          {/* Hero — no scroll reveal (it's above the fold) */}
          <LandingHeroV3 />

          {/* Section-to-section gradient transitions (soft, MEDIUM intensity) */}
          <div className="pointer-events-none absolute inset-x-0 top-[100vh] h-32 bg-gradient-to-b from-transparent to-[#08080f]" aria-hidden />

          <LandingScrollReveal>
            <LandingMissionProof />
          </LandingScrollReveal>

          <LandingScrollReveal delay={100}>
            <LandingProductCards />
          </LandingScrollReveal>

          <LandingScrollReveal>
            <LandingStudioFlow />
          </LandingScrollReveal>

          <LandingScrollReveal delay={100}>
            <LandingHowItWorks />
          </LandingScrollReveal>

          <LandingScrollReveal>
            <LandingBuiltWithLiTT />
          </LandingScrollReveal>

          <LandingScrollReveal delay={100}>
            <LandingTrust />
          </LandingScrollReveal>

          <LandingScrollReveal>
            <LandingPricing />
          </LandingScrollReveal>

          <LandingScrollReveal delay={100}>
            <LandingRoadmap />
          </LandingScrollReveal>

          <LandingScrollReveal>
            <LandingCTA />
          </LandingScrollReveal>
        </main>
        <LandingFooter />
      </div>
    </>
  );
}
