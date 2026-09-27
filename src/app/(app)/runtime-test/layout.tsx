import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { isPublicTestPageBlocked } from "@/lib/public-test-pages";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  if (isPublicTestPageBlocked()) notFound();
  return {
    robots: { index: false, follow: false },
  };
}

export default function RuntimeTestLayout({ children }: { children: ReactNode }) {
  if (isPublicTestPageBlocked()) notFound();
  return children;
}
