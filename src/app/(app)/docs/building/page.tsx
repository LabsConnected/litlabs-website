import type { Metadata } from "next";
import { Suspense } from "react";
import BuildingClient from "./BuildingClient";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Building with LiTT",
  description:
    "Real example prompts for building with LiTT and the build → verify → preview → deploy loop, plus how to verify and steer the work.",
  path: "/docs/building",
  index: true,
});

export default function BuildingPage() {
  return (
    <Suspense fallback={<div className="min-h-[40vh]" />}>
      <BuildingClient />
    </Suspense>
  );
}
