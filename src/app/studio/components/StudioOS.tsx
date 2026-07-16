"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import type { StudioTool } from "./StudioSidebar";
import { VoiceSessionProvider } from "../context/VoiceSessionContext";

const LITTTerminalShell = dynamic(() => import("./LITTTerminalShell"), {
  ssr: false,
});

const VALID_TOOLS: StudioTool[] = [
  "chat",
  "image",
  "video",
  "audio",
  "agents",
  "terminal",
  "builder",
  "pipeline",
  "gallery",
  "canvas",
  "clibridge",
  "space",
];

export default function StudioOS() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlTool = searchParams.get("tool");

  const initialTool: StudioTool =
    urlTool && VALID_TOOLS.includes(urlTool as StudioTool)
      ? (urlTool as StudioTool)
      : "chat";

  const [activeTool, setActiveTool] = useState<StudioTool>(initialTool);
  const isInitialMount = useRef(true);

  useEffect(() => {
    const storedTool = localStorage.getItem("littree:studio:tool");
    if (storedTool && VALID_TOOLS.includes(storedTool as StudioTool)) {
      setActiveTool(storedTool as StudioTool);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("littree:studio:tool", activeTool);
    } catch {
      // ignore storage errors
    }
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    if (activeTool !== "chat") params.set("tool", activeTool);
    else params.delete("tool");
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }, [activeTool, pathname, router, searchParams]);

  const terminalToolChange = useCallback(
    (tool: StudioTool) => {
      if (VALID_TOOLS.includes(tool)) {
        setActiveTool(tool);
      }
    },
    [setActiveTool],
  );

  return (
    <VoiceSessionProvider>
      <LITTTerminalShell
        activeTool={activeTool}
        onToolChangeAction={terminalToolChange}
      />
    </VoiceSessionProvider>
  );
}
