import type { Metadata } from "next";
import DeploymentsPageClient from "./DeploymentsPageClient";

export const metadata: Metadata = {
  title: "Deployments | LiTTree LabStudios",
  description: "Track project deployments, previews, and production releases.",
};

export default function DeploymentsPage() {
  return <DeploymentsPageClient />;
}
