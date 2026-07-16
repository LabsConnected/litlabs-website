"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import type { StudioTool } from "./LITTTerminalShell";
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

const STORAGE_KEY = "littree:studio:tool";

function resolveValidTool(tool: string | null | undefined): StudioTool | null {
  if (!tool) return null;
  return VALID_TOOLS.includes(tool as StudioTool) ? (tool as StudioTool) : null;
}

export default function StudioOS() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlTool = searchParams?.get("tool") ?? null;
  const [fallbackTool, setFallbackTool] = useState<StudioTool>("chat");
  const [mounted, setMounted] = useState(false);

  const activeTool = useMemo(
    () => resolveValidTool(urlTool) ?? fallbackTool,
    [urlTool, fallbackTool],
  );

  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const valid = resolveValidTool(stored);
      setFallbackTool((current) => (valid && valid !== current ? valid : current));
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(STORAGE_KEY, activeTool);
    } catch {
      // ignore storage errors
    }
  }, [activeTool, mounted]);

  useEffect(() => {
    if (!mounted || urlTool) return;
    // URL is the source of truth; if it has no tool, replace with the
    // persisted fallback so the active tool is always reflected in the URL.
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (activeTool === "chat") {
      params.delete("tool");
    } else {
      params.set("tool", activeTool);
    }
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }, [mounted, urlTool, activeTool, pathname, router, searchParams]);

  const selectTool = useCallback(
    (tool: StudioTool) => {
      if (!VALID_TOOLS.includes(tool)) return;
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (tool === "chat") {
        params.delete("tool");
      } else {
        params.set("tool", tool);
      }
      const query = params.toString();
      router.push(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return (
    <VoiceSessionProvider>
      <LITTTerminalShell
        activeTool={activeTool}
        onToolChangeAction={selectTool}
      />
    </VoiceSessionProvider>
  );
}
