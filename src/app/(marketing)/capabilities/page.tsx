import type { Metadata } from "next";
import { CapabilityGrid } from "@/app/HomePageClient";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "AI Project Operator Capabilities",
  description: "See how LiTT, your AI Project Operator, plans work, builds and edits project files, verifies results, and prepares projects to ship.",
  path: "/capabilities",
  index: true,
});

export default function CapabilitiesPage() {
  return (
    <main id="main-content" className="min-h-dvh overflow-hidden bg-[#03050a] pt-[68px] text-white">
      <div className="mx-auto max-w-[1500px] px-5 pt-16 lg:px-8 lg:pt-20">
        <div className="max-w-3xl">
          <div className="litt-eyebrow">AI Project Operator</div>
          <h1 className="mt-5 text-[clamp(2.75rem,7vw,6rem)] font-black leading-[0.92] tracking-[-0.065em]">
            Everything between <span className="litt-gradient-text">idea and done.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-white/58 sm:text-lg sm:leading-8">
            See how LiTT plans and builds projects in real files, coordinates creative and technical work, verifies results, and helps you prepare to ship.
          </p>
        </div>
      </div>
      <CapabilityGrid />
    </main>
  );
}
