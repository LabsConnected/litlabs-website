import type { Metadata } from "next";
import { Suspense } from "react";
import CliDocsClient from "./CliDocsClient";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "CLI: Installation & Commands",
  description:
    "Install the LiTT CLI (@litlabs1/litt-cli), sign in, and use the real commands: doctor, check, build, test, deploy verify, production finish, and more.",
  path: "/docs/cli",
  index: true,
});

export default function CliDocsPage() {
  return (
    <Suspense fallback={<div className="min-h-[40vh]" />}>
      <CliDocsClient />
    </Suspense>
  );
}
