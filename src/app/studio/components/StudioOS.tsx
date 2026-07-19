"use client";

import { useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import type { StudioTool } from "./LITTTerminalShell";
import { VoiceSessionProvider } from "../context/VoiceSessionContext";

const LITTTerminalShell = dynamic(() => import("./LITTTerminalShell"), {
  ssr: false,
});

// All legacy tools have been merged into the Builder hub. Old URLs with
// ?tool=... are silently redirected to plain /studio so bookmarks don't break.
const LEGACY_TOOLS = new Set([
  "chat",
  "image",
  "video",
  "audio",
  "terminal",
  "builder",
  "agents",
  "pipeline",
  "gallery",
  "canvas",
  "clibridge",
  "space",
  "loops",
]);

export default function StudioOS() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlTool = searchParams?.get("tool") ?? null;

  // Strip legacy ?tool= from the URL — everything is Builder now.
  useEffect(() => {
    if (urlTool && LEGACY_TOOLS.has(urlTool)) {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.delete("tool");
      const query = params.toString();
      router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
    }
  }, [urlTool, pathname, router, searchParams]);

  const selectTool = useCallback(
    (_tool: StudioTool) => {
      // No-op: all tools are Builder now. Kept for API compatibility.
    },
    [],
  );

  return (
    <VoiceSessionProvider>
      <LITTTerminalShell
        activeTool="builder"
        onToolChangeAction={selectTool}
      />
    </VoiceSessionProvider>
  );
}
