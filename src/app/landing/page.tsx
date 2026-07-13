import type { Metadata } from "next";
import { LandingHeader } from "./_components/LandingHeader";
import { LandingHero } from "./_components/LandingHero";
import { LandingLogos } from "./_components/LandingLogos";
import { LandingFeatures } from "./_components/LandingFeatures";
import { LandingHowItWorks } from "./_components/LandingHowItWorks";
import { LandingStats } from "./_components/LandingStats";
import { LandingTestimonials } from "./_components/LandingTestimonials";
import { LandingCTA } from "./_components/LandingCTA";
import { LandingFooter } from "./_components/LandingFooter";
import { LandingBackground } from "./_components/LandingBackground";

export const metadata: Metadata = {
  title: "LiTTree-LabStudios — Build with your AI crew",
  description:
    "A modern creator operating system powered by AI agents. Build, automate, and ship digital products in one workspace.",
};

export default function ModernLandingPage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#06060e] text-neutral-100">
      <LandingBackground />
      <LandingHeader />
      <main className="relative z-10">
        <LandingHero />
        <LandingLogos />
        <LandingFeatures />
        <LandingHowItWorks />
        <LandingStats />
        <LandingTestimonials />
        <LandingCTA />
      </main>
      <LandingFooter />
    </div>
  );
}
