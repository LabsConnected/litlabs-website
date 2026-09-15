import type { Metadata } from "next";
import { Suspense } from "react";
import StudioGuideClient from "./StudioGuideClient";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Studio Guide",
  description:
    "Tour the LiTT Studio interface: LiTT chat and agents, Plan, Canvas, Code, Preview, Media, Files, Terminal, activity, and the Deploy button.",
  path: "/docs/studio",
  index: true,
});

export default function StudioGuidePage() {
  return (
    <Suspense fallback={<div className="min-h-[40vh]" />}>
      <StudioGuideClient />
    </Suspense>
  );
}
