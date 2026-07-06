"use client";

import { useState, useCallback, useRef } from "react";
import { Play } from "lucide-react";
import TopBar from "./TopBar";
import BackgroundTerminal from "./BackgroundTerminal";
import ChatPanel, { Message } from "./ChatPanel";
import CommandDock from "./CommandDock";
import DrawerPanel from "./DrawerPanel";
import LeftRail from "./LeftRail";
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
  websocketStatus: "connected",
};

type DrawerTab = "terminal" | "files" | "preview" | "agents" | "memory";

export default function LitConsole() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("terminal");
  const [activeAgent, setActiveAgent] = useState("Director");
  const [activeModel, setActiveModel] = useState("gemini-2.5-flash");
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [pendingRun, setPendingRun] = useState<{ runId: string | null; plan: { goal: string; steps: Array<{ id: string; title: string; command?: string | null; needs_approval?: boolean; risk_level?: string }> } } | null>(null);
  const termRef = useRef<LiTTreeTerminalHandle>(null);

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

  const handleRun = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setMessages((prev) => [
      ...prev,
      { id: Math.random().toString(36).slice(2), role: "user", content: `${text} /run` },
    ]);
    setLoading(true);
    setInput("");
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: text }),
      });
      const payload = await res.json();
      if (!payload.ok) throw new Error(payload.error || "Planning failed");
      setPendingRun(payload);
      setMessages((prev) => [
        ...prev,
        { id: Math.random().toString(36).slice(2), role: "system", content: `Planned: ${payload.plan.goal}` },
      ]);
      if (payload.plan.steps.some((s: { needs_approval?: boolean }) => s.needs_approval)) {
        setMessages((prev) => [
          ...prev,
          { id: Math.random().toString(36).slice(2), role: "system", content: "Plan includes steps requiring approval." },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: Math.random().toString(36).slice(2), role: "lit", content: err instanceof Error ? err.message : "Planning failed." },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading]);

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

  const handleAgentChange = useCallback((agent: string) => {
    setActiveAgent(agent);
    setMessages((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).slice(2),
        role: "system",
        content: `Switched to ${agent} agent.`,
      },
    ]);
  }, []);

  const handleModelChange = useCallback((model: string) => {
    setActiveModel(model);
    setMessages((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).slice(2),
        role: "system",
        content: `Switched to ${model}.`,
      },
    ]);
  }, []);

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
          <div className="mt-1 text-xs">
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
          <div className="mt-1 text-xs">
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
          <div className="mt-1 text-xs">
            Director, Coder, Writer, Social, Data.
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
        <div className="mt-1 text-xs">
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

      <div className="relative z-10 flex flex-1 overflow-hidden">
        <LeftRail
          activeAgent={activeAgent}
          onAgentChange={handleAgentChange}
          collapsed={railCollapsed}
          onToggle={() => setRailCollapsed((v) => !v)}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-hidden p-4 pb-2">
            <ChatPanel
              messages={messages}
              onSend={(text) => {
                if (text === "/run") return handleRun();
                handleSend(text);
              }}
              loading={loading}
              plan={pendingRun ? { runId: pendingRun.runId, steps: pendingRun.plan.steps.map((s) => ({ id: s.id, title: s.title, command: s.command ?? null, needs_approval: s.needs_approval, risk_level: s.risk_level })) } : undefined}
              onApprove={(cmd) => {
                setPendingCommand(cmd);
                handleApprove();
              }}
              onApproveStep={async (runId, command) => {
                setPendingCommand(command);
                handleApprove();
              }}
              onApprovePlan={() => {
                if (!pendingRun?.plan?.steps?.length) return;
                const first = pendingRun.plan.steps[0];
                if (first.command) {
                  setPendingCommand(first.command);
                  handleApprove();
                }
                setPendingRun(null);
              }}
            />
          </div>

          <CommandDock
            value={input}
            onChange={setInput}
            onSend={() => handleSend()}
            onRun={!loading ? handleRun : undefined}
            agent={activeAgent}
            model={activeModel}
            onAgentChange={handleAgentChange}
            onModelChange={handleModelChange}
            onAttach={() => handleSend("Attach a file...")}
            onTools={() => setDrawerOpen((v) => !v)}
            onToggleTerminal={() => {
              setDrawerTab("terminal");
              setDrawerOpen((v) => !v);
            }}
            onCreateFile={() => handleSend("Create a new file")}
            onBuild={() => handleSend("Build the project")}
            onGenerateMedia={() => handleSend("Generate media")}
            onDeploy={() => handleSend("Deploy to production")}
            onSaveWorkflow={() => handleSend("Save this workflow")}
          />
        </main>
      </div>

      {pendingCommand && (
        <div
          className="fixed bottom-28 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border px-4 py-2 text-xs font-semibold shadow-lg"
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

      <DrawerPanel
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        position="right"
        activeTab={drawerTab}
        onTabChange={(tab) => setDrawerTab(tab as DrawerTab)}
      >
        {drawerContent}
      </DrawerPanel>
    </div>
  );
}
