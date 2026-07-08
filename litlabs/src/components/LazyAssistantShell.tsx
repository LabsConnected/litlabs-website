"use client";

import { usePathname } from "next/navigation";
import { LiTAssistantProvider } from "@/context/LiTAssistantContext";
import GlobalLiTAssistant from "@/components/GlobalLiTAssistant";

export default function LazyAssistantShell() {
  const pathname = usePathname();

  if (pathname?.startsWith("/studio")) return null;

  return (
    <LiTAssistantProvider>
      <GlobalLiTAssistant />
    </LiTAssistantProvider>
  );
}
