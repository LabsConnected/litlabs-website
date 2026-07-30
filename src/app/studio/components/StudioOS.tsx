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
  "color",
  "space",
  "loops",
];

const MIGRATED_TOOLS: Partial<Record<StudioTool, StudioTool>> = {
  chat: "builder",
  terminal: "builder",
  image: "builder",
  video: "builder",
  audio: "builder",
  agents: "builder",
  pipeline: "builder",
  gallery: "builder",
  canvas: "builder",
  clibridge: "builder",
  color: "builder",
  space: "builder",
  loops: "builder",
};

function normalizeTool(tool: string | null): StudioTool {
  if (!tool) return "builder";
  const t = tool as StudioTool;
  if (MIGRATED_TOOLS[t]) return MIGRATED_TOOLS[t]!;
  return "builder";
}

export default function StudioOS() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlTool = searchParams.get("tool");

  const initialTool: StudioTool = normalizeTool(urlTool);

  const [activeTool, setActiveTool] = useState<StudioTool>(initialTool);
  const isInitialMount = useRef(true);

  useEffect(() => {
    const storedTool = localStorage.getItem("littree:studio:tool");
    if (storedTool) {
      const normalized = normalizeTool(storedTool);
      setActiveTool(normalized);
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
    if (activeTool !== "builder") params.set("tool", activeTool);
    else params.delete("tool");
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }, [activeTool, pathname, router, searchParams]);

  const terminalToolChange = useCallback(
    (tool: StudioTool) => {
      const normalized = MIGRATED_TOOLS[tool] ?? tool;
      if (VALID_TOOLS.includes(normalized)) {
        setActiveTool(normalized);
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
