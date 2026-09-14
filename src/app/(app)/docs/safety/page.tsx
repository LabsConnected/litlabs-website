import type { Metadata } from "next";
import { Suspense } from "react";
import SafetyDocsClient from "./SafetyDocsClient";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Safety & Approvals",
  description:
    "How LiTT asks for approval before consequential actions, CLI permission modes (plan, act, auto), and model routing with provider health.",
  path: "/docs/safety",
  index: true,
});

export default function SafetyDocsPage() {
  return (
    <Suspense fallback={<div className="min-h-[40vh]" />}>
      <SafetyDocsClient />
    </Suspense>
  );
}
