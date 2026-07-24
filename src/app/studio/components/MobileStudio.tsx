"use client";

import { useCallback, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import type { StudioTool } from "./StudioSidebar";
import { useStudioAgentStore } from "../stores/useStudioAgentStore";
import { useStudioModelStore } from "../stores/useStudioModelStore";
import MultimodalComposer from "./MultimodalComposer";

export function MobileStudio({
  onRouteTool,
}: {
  onRouteTool: (tool: StudioTool, command?: string) => void;
}) {
  const { resolvedColors: T } = useTheme();
  const activeAgentId = useStudioAgentStore((s) => s.activeAgentId);
  const selectedModel = useStudioModelStore((s) => s.selectedModel);
  const [input, setInput] = useState("");

  const handleSend = useCallback(async (text: string) => {
    if (!text.trim()) return "";
    onRouteTool("chat", text);
    setInput("");
    return "";
  }, [onRouteTool]);

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden"
      style={{ background: T.bgColor, color: T.textColor }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        <p className="text-sm text-white/40">Mobile Studio — select a tool from the bottom nav.</p>
      </div>
      <div
        className="sticky bottom-0 z-10 border-t px-3 py-2"
        style={{ borderColor: `${T.textColor}11`, background: T.bgColor }}
      >
        <MultimodalComposer
          value={input}
          onChange={setInput}
          onSend={handleSend}
          modelName={selectedModel.label}
          activeAgentId={activeAgentId}
          onRouteTool={onRouteTool}
        />
      </div>
    </div>
  );
}
