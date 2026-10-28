import type { Metadata } from "next";
import { guardDevHarnessRoute } from "@/lib/dev-harness";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function RuntimeTestLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  guardDevHarnessRoute();
  return children;
}
