import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import { LandingHeader } from "./_components/LandingHeader";
import { LandingHero } from "./_components/LandingHero";
import { LandingLogos } from "./_components/LandingLogos";
import { LandingComparison } from "./_components/LandingComparison";
import { LandingHowItWorks } from "./_components/LandingHowItWorks";
import { LandingFeatures } from "./_components/LandingFeatures";
import { LandingTreeOS } from "./_components/LandingTreeOS";
import { LandingStats } from "./_components/LandingStats";
import { LandingCTA } from "./_components/LandingCTA";
import { LandingFooter } from "./_components/LandingFooter";
import { LandingBackground } from "./_components/LandingBackground";

export const metadata: Metadata = buildMetadata({
  title: "Bring the idea. LiTT helps you build the rest.",
  description:
    "Build apps, create media, preserve project context, collaborate and ship real work from Studio. Free to join.",
  path: "/landing",
  index: true,
});

export default function ModernLandingPage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#06060e] text-neutral-100">
      <LandingBackground />
      <LandingHeader />
      <main className="relative z-10">
        <LandingHero />
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
  );
}
