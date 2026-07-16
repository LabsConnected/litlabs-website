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
  "terminal",
  "builder",
  "pipeline",
  "gallery",
  "canvas",
  "clibridge",
  "space",
  "loops",
];

const MIGRATED_TOOLS: Record<string, StudioTool> = {
  agents: "builder",
};

const STORAGE_KEY = "littree:studio:tool";

function resolveValidTool(tool: string | null | undefined): StudioTool | null {
  if (!tool) return null;
  const normalized = MIGRATED_TOOLS[tool] ?? tool;
  return VALID_TOOLS.includes(normalized as StudioTool)
    ? (normalized as StudioTool)
    : null;
}

function normalizeTool(tool: StudioTool): StudioTool {
  return MIGRATED_TOOLS[tool] ?? tool;
}

export default function StudioOS() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlTool = searchParams?.get("tool") ?? null;
  const [fallbackTool, setFallbackTool] = useState<StudioTool>("builder");
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
    if (urlTool === "agents") {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("tool", "builder");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      return;
    }
    if (!mounted || urlTool) return;
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (activeTool === "builder") {
      params.set("tool", "builder");
    } else if (activeTool === "chat") {
      params.delete("tool");
    } else {
      params.set("tool", activeTool);
    }
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }, [mounted, urlTool, activeTool, pathname, router, searchParams]);

  const selectTool = useCallback(
    (tool: StudioTool) => {
      const target = normalizeTool(tool);
      if (!VALID_TOOLS.includes(target)) return;
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (target === "builder") {
        params.set("tool", "builder");
      } else if (target === "chat") {
        params.delete("tool");
      } else {
        params.set("tool", target);
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
