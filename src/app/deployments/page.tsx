import type { Metadata } from "next";
import DeploymentsPageClient from "./DeploymentsPageClient";

export const metadata: Metadata = {
  title: "Deployments",
  description: "Track project deployments, previews, and production releases.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function DeploymentsPage() {
  return <DeploymentsPageClient />;
}
