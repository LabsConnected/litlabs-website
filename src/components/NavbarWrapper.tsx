"use client";

import Navbar from "@/components/Navbar";

export default function NavbarWrapper({ onMenuClick }: { onMenuClick?: () => void }) {
  return <Navbar onMenuClick={onMenuClick} />;
}
