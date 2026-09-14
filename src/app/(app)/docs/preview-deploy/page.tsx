import type { Metadata } from "next";
import { Suspense } from "react";
import PreviewDeployClient from "./PreviewDeployClient";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Preview & Deployment",
  description:
    "How LiTT Studio preview works, how it differs from production deployment, preview states and retries, deployment approvals, and verified live URLs.",
  path: "/docs/preview-deploy",
  index: true,
});

export default function PreviewDeployPage() {
  return (
    <Suspense fallback={<div className="min-h-[40vh]" />}>
      <PreviewDeployClient />
    </Suspense>
  );
}
