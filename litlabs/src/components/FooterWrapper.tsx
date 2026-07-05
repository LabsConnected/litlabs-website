"use client";

import { usePathname } from "next/navigation";
import Footer from "@/components/Footer";

const HIDE_PATHS = ["/dashboard"];

export default function FooterWrapper() {
  const pathname = usePathname();
  const hidden = HIDE_PATHS.some((p) => pathname === p || pathname?.startsWith(p + "?") || pathname?.startsWith(p + "/"));
  if (hidden) return null;
  return <Footer />;
}
