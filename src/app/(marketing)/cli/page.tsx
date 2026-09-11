import CliPageClient from "./CliPageClient";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "LiTT CLI",
  description:
    "Install the LiTT CLI and run AI-powered builds, checks, and deployments from your terminal.",
  path: "/cli",
});

export default function CliPage() {
  return <CliPageClient />;
}
