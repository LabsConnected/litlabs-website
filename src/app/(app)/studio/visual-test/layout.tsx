import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { gatePublicTestPage, isPublicTestPageBlocked } from "@/lib/public-test-pages";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  if (isPublicTestPageBlocked()) notFound();
  return {
    robots: { index: false, follow: false },
  };
}

export default function VisualTestLayout({ children }: { children: ReactNode }) {
  gatePublicTestPage();
  return children;
}
