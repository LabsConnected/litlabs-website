"use client";

import { LiTAssistantProvider } from "@/context/LiTAssistantContext";
import GlobalLiTAssistant from "@/components/GlobalLiTAssistant";

export default function LazyAssistantShell() {
  return (
    <LiTAssistantProvider>
      <GlobalLiTAssistant />
    </LiTAssistantProvider>
  );
}
