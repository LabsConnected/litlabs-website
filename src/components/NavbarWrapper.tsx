"use client";

import { usePathname } from "next/navigation";
import Navbar from "@/components/Navbar";

const HIDE_PATHS = ["/dashboard"];

export default function NavbarWrapper({ onMenuClick }: { onMenuClick?: () => void }) {
  const pathname = usePathname();
  const hidden = HIDE_PATHS.some((p) => pathname === p || pathname?.startsWith(p + "?") || pathname?.startsWith(p + "/"));
  if (hidden) return null;
  return <Navbar onMenuClick={onMenuClick} />;
}
