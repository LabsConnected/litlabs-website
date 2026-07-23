import { Suspense } from "react";
import DocsPageClient from "./DocsPageClient";

export const metadata = {
  title: "Docs | LiTTree-LabStudios",
  description:
    "Quick-start documentation for LiTTree-LabStudios: agents, Studio, flows, gallery, and support.",
};

export default function DocsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#03050a]" />}>
      <DocsPageClient />
    </Suspense>
  );
}
