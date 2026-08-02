import type { Metadata } from "next";
import LandingV2Client from "./LandingV2Client";

export const metadata: Metadata = {
  title: "Landing v2 Preview",
  description: "Internal preview — not for public access",
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
  openGraph: {
    title: "Landing v2 Preview",
    description: "Internal preview — not for public access",
  },
};

export default function LandingV2PreviewPage() {
  return <LandingV2Client />;
}
