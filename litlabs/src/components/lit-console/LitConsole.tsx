"use client";

import { useState, useCallback, useRef } from "react";
import { Terminal, Play } from "lucide-react";
import TopBar from "./TopBar";
import BackgroundTerminal from "./BackgroundTerminal";
import ChatPanel, { Message } from "./ChatPanel";
import CommandDock from "./CommandDock";
import DrawerPanel from "./DrawerPanel";
import {
  LiTTreeTerminal,
  LiTTreeTerminalHandle,
} from "@/components/terminal/LiTTreeTerminal";
import { LC } from "./lit-console-theme";
import type { LiTContext } from "@/lib/jarvis-context";

const initialContext: LiTContext = {
  route: "/lit-console",
  terminalOutput: "",
  commandHistory: [],
  logs: [],
  fileTree: [],
  agents: [{ name: "LiT", status: "online" }],
  websocketStatus: "offline",
};

export default function LitConsole() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<
    "terminal" | "files" | "preview" | "agents" | "memory"
  >("terminal");
  const [activeAgent, setActiveAgent] = useState("Director");
  const [activeModel, setActiveModel] = useState("gemini-2.5-flash");
  const termRef = useRef<LiTTreeTerminalHandle>(null);
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);

  const askLiT = useCallback(async (text: string) => {
    const toolId = Math.random().toString(36).slice(2);
    setMessages((prev) => [
      ...prev,
      {
        id: toolId,
        role: "tool",
        content: "LiT is thinking...",
        meta: { tool: "think", status: "running" },
      },
    ]);

    try {
      const res = await fetch("/api/jarvis/think", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          context: initialContext,
        }),
      });
      const data = await res.json();
      const answer = data.error
        ? `Error: ${data.error}`
        : data.answer || "No response.";

      setMessages((prev) =>
        prev.map((m) =>
          m.id === toolId
            ? { ...m, meta: { tool: m.meta?.tool || "think", status: "done" } }
            : m,
        ),
      );
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).slice(2),
          role: "lit",
          content: answer,
        },
      ]);

      const runAction = data.actions?.find(
        (a: { type: string; command?: string }) =>
          a.type === "run_command" && a.command,
      );
      if (runAction?.command) {
        setPendingCommand(runAction.command);
        setMessages((prev) => [
          ...prev,
          {
            id: Math.random().toString(36).slice(2),
            role: "system",
            content: `Approve command: \`${runAction.command}\``,
          },
        ]);
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === toolId
            ? { ...m, meta: { tool: m.meta?.tool || "think", status: "error" } }
            : m,
        ),
      );
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).slice(2),
          role: "lit",
          content: err instanceof Error ? err.message : "LiT failed.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSend = useCallback(
    (text?: string) => {
      const t = text || input;
      if (!t.trim() || loading) return;
      setMessages((prev) => [
        ...prev,
        { id: Math.random().toString(36).slice(2), role: "user", content: t },
      ]);
      setInput("");
      setLoading(true);
      askLiT(t);
    },
    [input, loading, askLiT],
  );

  const handleApprove = useCallback(() => {
    if (!pendingCommand) return;
    setMessages((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).slice(2),
        role: "system",
        content: `Running: \`${pendingCommand}\``,
      },
    ]);
    setDrawerOpen(true);
    setDrawerTab("terminal");
    setTimeout(() => {
      termRef.current?.runCommand(pendingCommand);
    }, 300);
    setPendingCommand(null);
  }, [pendingCommand]);

  const drawerContent = (() => {
    if (drawerTab === "terminal") {
      return (
        <div className="h-full w-full">
          <LiTTreeTerminal
            ref={termRef}
            mode="demo"
            showAgentSidebar={false}
            projectName="litlabs"
            className="h-full"
          />
        </div>
      );
    }
    if (drawerTab === "files") {
      return (
        <div
          className="flex h-full flex-col items-center justify-center p-6 text-center"
          style={{ color: LC.textMuted }}
        >
          <div className="text-sm font-semibold" style={{ color: LC.text }}>
            Files
          </div>
          <div className="text-xs mt-1">
            Connect to a workspace to browse files.
          </div>
        </div>
      );
    }
    if (drawerTab === "preview") {
      return (
        <div
          className="flex h-full flex-col items-center justify-center p-6 text-center"
          style={{ color: LC.textMuted }}
        >
          <div className="text-sm font-semibold" style={{ color: LC.text }}>
            Preview
          </div>
          <div className="text-xs mt-1">
            Live preview will appear when you run a dev server.
          </div>
        </div>
      );
    }
    if (drawerTab === "agents") {
      return (
        <div
          className="flex h-full flex-col items-center justify-center p-6 text-center"
          style={{ color: LC.textMuted }}
        >
          <div className="text-sm font-semibold" style={{ color: LC.text }}>
            Agents
          </div>
          <div className="text-xs mt-1">
            Director, Coder, Security Auditor, DevOps.
          </div>
        </div>
      );
    }
    return (
      <div
        className="flex h-full flex-col items-center justify-center p-6 text-center"
        style={{ color: LC.textMuted }}
      >
        <div className="text-sm font-semibold" style={{ color: LC.text }}>
          Memory
        </div>
        <div className="text-xs mt-1">
          Long-term project context and learnings.
        </div>
      </div>
    );
  })();

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden">
      <BackgroundTerminal />

      <TopBar
        projectName="litlabs"
        agentName={activeAgent}
        modelName={activeModel}
        status="online"
      />

      <main className="relative z-10 flex flex-1 justify-center overflow-hidden p-4 pb-2">
        <ChatPanel messages={messages} onSend={handleSend} loading={loading} />
      </main>

      {pendingCommand && (
        <div
          className="fixed bottom-28 left-1/2 z-40 -translate-x-1/2 flex items-center gap-3 rounded-full border px-4 py-2 text-xs font-semibold shadow-lg"
          style={{
            backgroundColor: LC.bgPanel,
            borderColor: LC.accentOrange,
            color: LC.text,
          }}
        >
          <span>
            Command ready:{" "}
            <code className="font-mono" style={{ color: LC.accentCyan }}>
              {pendingCommand}
            </code>
          </span>
          <button
            onClick={handleApprove}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 font-bold"
            style={{ backgroundColor: LC.accentOrange, color: "#000" }}
          >
            <Play size={12} /> Run
          </button>
        </div>
      )}

      <CommandDock
        value={input}
        onChange={setInput}
        onSend={() => handleSend()}
        onRun={() => handleSend("/scan")}
        agent={activeAgent}
        model={activeModel}
        onAgentChange={() =>
          setActiveAgent((a) => (a === "Director" ? "Coder" : "Director"))
        }
        onModelChange={() =>
          setActiveModel((m) =>
            m === "gemini-2.5-flash" ? "gemini-2.5-pro" : "gemini-2.5-flash",
          )
        }
      />

      <button
        onClick={() => {
          setDrawerOpen(true);
          setDrawerTab("terminal");
        }}
        className="fixed bottom-20 right-5 z-50 flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105"
        style={{ backgroundColor: LC.accentCyan, color: "#000" }}
      >
        <Terminal size={18} />
      </button>

      <DrawerPanel
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        position="right"
        activeTab={drawerTab}
        onTabChange={(tab) => setDrawerTab(tab as typeof drawerTab)}
      >
        {drawerContent}
      </DrawerPanel>
    </div>
  );
}
