"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Play, Search, Plus, Trash2, RefreshCw, ExternalLink, Brain, FolderOpen, Bot } from "lucide-react";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import ChatPanel, { Message } from "./ChatPanel";
import CommandDock from "./CommandDock";
import DrawerPanel from "./DrawerPanel";
import {
  LiTTreeTerminal,
  LiTTreeTerminalHandle,
} from "@/components/terminal/LiTTreeTerminal";
import { LC } from "./lit-console-theme";
import type { LiTContext } from "@/lib/jarvis-context";
import type { LiTTipResult } from "@/lib/lit-tip";
import { detectIntent, buildNavigationMessage } from "@/lib/intent-router";
import { actionFromIntent, actionMessage, executeAction } from "@/lib/lit-actions";

const initialContext: LiTContext = {
  route: "/studio?tool=chat",
  terminalOutput: "",
  commandHistory: [],
  logs: [],
  fileTree: [],
  agents: [{ name: "LiT", status: "online" }],
  websocketStatus: "connected",
};

type DrawerTab = "terminal" | "files" | "preview" | "agents" | "memory";
type ConsoleView = "dashboard" | "chat";

export default function LitConsole() {
  const { user } = useUser();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("terminal");
  const [view, setView] = useState<ConsoleView>("chat");
  const [mobileAgentDrawer, setMobileAgentDrawer] = useState(false);
  const [activeAgent, setActiveAgent] = useState("director");
  const [activeModel, setActiveModel] = useState("gemini-2.5-flash");
  const [litTip, setLitTip] = useState<LiTTipResult | null>(null);
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [pendingRun, setPendingRun] = useState<{
    runId: string | null;
    plan: {
      goal: string;
      steps: Array<{
        id: string;
        title: string;
        command?: string | null;
        needs_approval?: boolean;
        risk_level?: string;
      }>;
    };
  } | null>(null);
  const termRef = useRef<LiTTreeTerminalHandle>(null);

  // Debounced LiT-Tip scan as the user types
  useEffect(() => {
    const t = input.trim();
    if (!t) {
      setLitTip(null);
      return;
    }
    const timer = setTimeout(() => {
      fetch("/api/lit-tip/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: t, agent: activeAgent, model: activeModel }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.ok) setLitTip(data.result);
        })
        .catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [input, activeAgent, activeModel]);

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
          userContext: {
            username: user?.username || user?.firstName || undefined,
            plan: (user as unknown as { publicMetadata?: { plan?: string } })?.publicMetadata?.plan || undefined,
          },
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
            content: `Command ready: \`${runAction.command}\``,
          },
        ]);
      }

      // Auto-navigate if the AI returned a navigate action
      const navAction = data.actions?.find(
        (a: { type: string; url?: string }) =>
          a.type === "navigate" && a.url,
      );
      if (navAction?.url) {
        setTimeout(() => router.push(navAction.url!), 600);
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
      setView("chat");
      setMessages((prev) => [
        ...prev,
        { id: Math.random().toString(36).slice(2), role: "user", content: t },
      ]);
      setInput("");
      setLoading(true);

      // Intent detection — auto-navigate if clear
      const intent = detectIntent(t);
      if (intent.route && !intent.isAmbiguous) {
        const action = actionFromIntent(t, {
          route: { path: intent.route.path, label: intent.route.label },
          confidence: intent.confidence,
          isAmbiguous: intent.isAmbiguous,
        });
        if (action && action.type !== "navigate") {
          const toolId = Math.random().toString(36).slice(2);
          setMessages((prev) => [
            ...prev,
            {
              id: toolId,
              role: "tool",
              content: actionMessage(action),
              meta: { tool: action.type, status: "running" },
            },
          ]);
          executeAction(action)
            .then((result) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === toolId
                    ? {
                        ...m,
                        content: result.ok
                          ? result.message
                          : `${result.message}${result.error ? ` ${result.error}` : ""}`,
                        meta: {
                          tool: action.type,
                          status: result.ok ? "done" : "error",
                          images: result.images,
                        },
                      }
                    : m,
                ),
              );
            })
            .catch((err) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === toolId
                    ? {
                        ...m,
                        content:
                          err instanceof Error
                            ? err.message
                            : "Action failed.",
                        meta: { tool: action.type, status: "error" },
                      }
                    : m,
                ),
              );
            })
            .finally(() => setLoading(false));
          return;
        }

        const navMsg = buildNavigationMessage(intent);
        setMessages((prev) => [
          ...prev,
          {
            id: Math.random().toString(36).slice(2),
            role: "lit",
            content: navMsg,
          },
        ]);
        setTimeout(() => router.push(intent.route!.path), 800);
        setLoading(false);
        return;
      }

      if (intent.isAmbiguous && intent.suggestions.length > 0) {
        const navMsg = buildNavigationMessage(intent);
        setMessages((prev) => [
          ...prev,
          {
            id: Math.random().toString(36).slice(2),
            role: "lit",
            content: navMsg,
          },
        ]);
        setLoading(false);
        return;
      }

      askLiT(t);
    },
    [input, loading, askLiT, router],
  );

  const handleRun = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || loading) return;
      setView("chat");
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).slice(2),
          role: "user",
          content: `${text} /run`,
        },
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
          {
            id: Math.random().toString(36).slice(2),
            role: "system",
            content: `Planned: ${payload.plan.goal}`,
          },
        ]);
        if (
          payload.plan.steps.some(
            (s: { needs_approval?: boolean }) => s.needs_approval,
          )
        ) {
          setMessages((prev) => [
            ...prev,
            {
              id: Math.random().toString(36).slice(2),
              role: "system",
              content: "Plan includes steps requiring approval.",
            },
          ]);
        }
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: Math.random().toString(36).slice(2),
            role: "lit",
            content: err instanceof Error ? err.message : "Planning failed.",
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [input, loading],
  );

  const approveCommand = useCallback((command: string) => {
    if (!command) return;
    setMessages((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).slice(2),
        role: "system",
        content: `Running: \`${command}\``,
      },
    ]);
    setDrawerOpen(true);
    setDrawerTab("terminal");
    setTimeout(() => {
      termRef.current?.runCommand(command);
    }, 300);
    setPendingCommand(null);
  }, []);

  const handleApprove = useCallback(() => {
    if (!pendingCommand) return;
    approveCommand(pendingCommand);
  }, [approveCommand, pendingCommand]);

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
    if (drawerTab === "files") return <FilesPanel onPrompt={handleSend} />;
    if (drawerTab === "preview") return <PreviewPanel />;
    if (drawerTab === "agents") return <AgentsPanel activeAgent={activeAgent} onSelect={handleAgentChange} onPrompt={handleSend} />;
    return <MemoryPanel />;
  })();

  return (
    <div className="flex h-full w-full flex-col" style={{ backgroundColor: LC.bg }}>
      {/* Main content area — chat only, dashboard accessible via drawer */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Desktop: chat only */}
        <div className="hidden md:flex flex-1 min-h-0 flex-col overflow-hidden">
          <ChatPanel
            messages={messages}
            onSend={(text) => {
              if (text === "/run") return handleRun();
              handleSend(text);
            }}
            loading={loading}
            plan={
              pendingRun
                ? {
                    runId: pendingRun.runId,
                    steps: pendingRun.plan.steps.map((s) => ({
                      id: s.id,
                      title: s.title,
                      command: s.command ?? null,
                      needs_approval: s.needs_approval,
                      risk_level: s.risk_level,
                    })),
                  }
                : undefined
            }
            onApprove={(cmd) => approveCommand(cmd)}
            onApproveStep={async (_runId, command) => approveCommand(command)}
            onApprovePlan={() => {
              if (!pendingRun?.plan?.steps?.length) return;
              const first = pendingRun.plan.steps[0];
              if (first.command) approveCommand(first.command);
              setPendingRun(null);
            }}
          />
        </div>

        {/* Mobile: always chat-first */}
        <div className="md:hidden flex-1 min-h-0 overflow-hidden">
          <ChatPanel
            messages={messages}
            onSend={(text) => {
              if (text === "/run") return handleRun();
              handleSend(text);
            }}
            loading={loading}
            plan={
              pendingRun
                ? {
                    runId: pendingRun.runId,
                    steps: pendingRun.plan.steps.map((s) => ({
                      id: s.id,
                      title: s.title,
                      command: s.command ?? null,
                      needs_approval: s.needs_approval,
                      risk_level: s.risk_level,
                    })),
                  }
                : undefined
            }
            onApprove={(cmd) => approveCommand(cmd)}
            onApproveStep={async (_runId, command) => approveCommand(command)}
            onApprovePlan={() => {
              if (!pendingRun?.plan?.steps?.length) return;
              const first = pendingRun.plan.steps[0];
              if (first.command) approveCommand(first.command);
              setPendingRun(null);
            }}
          />
        </div>
      </div>

      {/* Command dock always at bottom */}
      <CommandDock
        value={input}
        onChange={setInput}
        onSend={() => handleSend()}
        onRun={!loading ? handleRun : undefined}
        litTip={litTip}
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
        onGenerateMedia={() => handleSend("Generate an image")}
        onDeploy={() => handleSend("Run: npx vercel --prod to deploy the current project")}
        onSaveWorkflow={() => handleSend("Save this workflow as a reusable automation")}
      />

      {/* Pending command approval toast */}
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

// ─── Drawer Panel Components ──────────────────────────────────────────────────

const STUDIO_TOOLS = [
  { id: "image", label: "Image Agent", href: "/studio?tool=chat", icon: "🎨" },
  { id: "video", label: "Video Studio", href: "/studio?tool=video", icon: "🎬" },
  { id: "audio", label: "Music Studio", href: "/studio?tool=audio", icon: "🎵" },
  { id: "agents", label: "LiTTree Agent", href: "/studio?tool=chat", icon: "🤖" },
  { id: "gallery", label: "Asset Gallery", href: "/studio?tool=gallery", icon: "🖼" },
  { id: "terminal", label: "Command Tools", href: "/studio?tool=chat", icon: "⚡" },
];

function FilesPanel({ onPrompt }: { onPrompt: (t: string) => void }) {
  const [files, setFiles] = useState<{ name: string; type: string; time: string }[]>([]);
  useEffect(() => {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith("litlabs-"));
    setFiles(keys.map((k) => ({ name: k.replace("litlabs-", ""), type: "data", time: "local" })));
  }, []);
  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto" style={{ color: LC.text }}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest" style={{ color: LC.textMuted }}>
        <FolderOpen size={13} /> Studio Tools
      </div>
      <div className="grid grid-cols-2 gap-2">
        {STUDIO_TOOLS.map((t) => (
          <a key={t.id} href={t.href}
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition-all hover:scale-[1.02]"
            style={{ borderColor: LC.border, backgroundColor: LC.bgSecondary, color: LC.text }}
          >
            <span>{t.icon}</span>{t.label}
          </a>
        ))}
      </div>
      {files.length > 0 && (
        <>
          <div className="flex items-center gap-2 mt-2 text-[10px] uppercase tracking-widest" style={{ color: LC.textMuted }}>
            <FolderOpen size={13} /> Cached Data
          </div>
          <div className="flex flex-col gap-1">
            {files.map((f) => (
              <div key={f.name}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-xs"
                style={{ backgroundColor: LC.bgSecondary, borderLeft: `3px solid ${LC.accentCyan}40` }}
              >
                <span style={{ color: LC.text }}>{f.name}</span>
                <button onClick={() => onPrompt(`Tell me about ${f.name}`)}
                  className="text-[10px] opacity-50 hover:opacity-100"
                  style={{ color: LC.accentCyan }}
                >ask</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PreviewPanel() {
  const [url, setUrl] = useState("https://litlabs.net");
  const [input, setInput] = useState("https://litlabs.net");
  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") setUrl(input); }}
          className="flex-1 rounded-lg border px-3 py-1.5 text-xs outline-none"
          style={{ backgroundColor: LC.bgSecondary, borderColor: LC.border, color: LC.text }}
          placeholder="https://..."
        />
        <button onClick={() => setUrl(input)}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold"
          style={{ backgroundColor: LC.accentCyan, color: "#000" }}
        >
          <RefreshCw size={12} /> Go
        </button>
        <a href={url} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs"
          style={{ borderColor: LC.border, color: LC.textMuted }}
        ><ExternalLink size={12} /></a>
      </div>
      <iframe
        src={url}
        className="flex-1 w-full rounded-lg border"
        style={{ borderColor: LC.border, minHeight: 320 }}
        sandbox="allow-scripts allow-same-origin allow-forms"
      />
    </div>
  );
}

const AGENT_LIST = [
  { id: "director",       name: "LiTTree",        role: "Core AI Copilot",        color: "#22d3ee", status: "online", desc: "Your main AI brain — plans, routes, and navigates." },
  { id: "forge",          name: "Forge",           role: "Engineer & Architect",    color: "#22d3ee", status: "online", desc: "Writes, reviews, debugs, and ships production code." },
  { id: "pulse",          name: "Pulse",           role: "Growth & Analytics",      color: "#f472b6", status: "online", desc: "Growth loops, content strategy, and data insights." },
  { id: "pixel-forge",    name: "Visionary",       role: "Creative Director",       color: "#e879f9", status: "idle",   desc: "Crafts prompts, brand visuals, and UI direction." },
  { id: "social-pilot",   name: "SocialPilot",     role: "Social Media Growth",     color: "#a855f7", status: "idle",   desc: "Platform-native content that stops the scroll." },
  { id: "data-slayer",    name: "Data Slayer",     role: "Analytics & Insights",    color: "#fbbf24", status: "online", desc: "Interprets metrics and turns numbers into decisions." },
  { id: "writing-coach",  name: "Writing Coach",   role: "Content & Copy",          color: "#a78bfa", status: "idle",   desc: "Edits, rewrites, and sharpens all words." },
  { id: "music-producer", name: "Music Producer",  role: "Audio & Sound",           color: "#fb7185", status: "idle",   desc: "Composition, mixing, and sound design guidance." },
  { id: "nexus",          name: "Nexus",           role: "Automation & Integrations",color: "#34d399", status: "idle",   desc: "Connects devices, APIs, webhooks, smart home." },
  { id: "security-chief", name: "Security Chief",  role: "Security & Privacy",      color: "#ef4444", status: "online", desc: "Audits, protects, and locks down your systems." },
];

function AgentsPanel({ activeAgent, onSelect, onPrompt }: { activeAgent: string; onSelect: (a: string) => void; onPrompt: (t: string) => void }) {
  return (
    <div className="flex flex-col gap-2 h-full overflow-y-auto">
      <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: LC.textMuted }}>
        <Bot size={13} className="inline mr-1" />Active Agents
      </div>
      {AGENT_LIST.map((a) => {
        const isActive = activeAgent === a.id;
        return (
          <div key={a.id}
            className="rounded-xl border p-3 cursor-pointer transition-all hover:scale-[1.01]"
            style={{
              borderColor: isActive ? a.color + "60" : LC.border,
              backgroundColor: isActive ? a.color + "10" : LC.bgSecondary,
              boxShadow: isActive ? `0 0 12px ${a.color}20` : "none",
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: a.status === "online" ? "#22c55e" : "#6b7280" }} />
                <span className="text-xs font-bold" style={{ color: a.color }}>{a.name}</span>
                <span className="text-[9px] uppercase tracking-wider opacity-50" style={{ color: LC.textMuted }}>{a.role}</span>
              </div>
              <div className="flex gap-1">
                <button onClick={() => onSelect(a.id)}
                  className="rounded-md px-2 py-0.5 text-[10px] font-bold"
                  style={{ backgroundColor: isActive ? a.color : a.color + "20", color: isActive ? "#000" : a.color }}
                >Use</button>
                <button onClick={() => onPrompt(`Ask ${a.name}: `)}
                  className="rounded-md px-2 py-0.5 text-[10px] border"
                  style={{ borderColor: LC.border, color: LC.textMuted }}
                >Chat</button>
              </div>
            </div>
            <p className="text-[10px] opacity-60" style={{ color: LC.text }}>{a.desc}</p>
          </div>
        );
      })}
    </div>
  );
}

function MemoryPanel() {
  const { user } = useUser();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id?: string; content: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [newMem, setNewMem] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const search = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/memory?q=${encodeURIComponent(query)}&userId=${user?.id || "default"}&limit=8`);
      const data = await res.json();
      setResults(Array.isArray(data.results) ? data.results : Array.isArray(data) ? data : []);
    } catch { setResults([]); }
    finally { setLoading(false); }
  };

  const save = async () => {
    if (!newMem.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newMem.trim(), userId: user?.id || "default" }),
      });
      setStatus("Saved to Supermemory ✓");
      setNewMem("");
      setTimeout(() => setStatus(null), 2500);
    } catch { setStatus("Save failed"); }
    finally { setSaving(false); }
  };

  const forget = async (id?: string, content?: string) => {
    if (!id && !content) return;
    await fetch("/api/memory", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, content, userId: user?.id || "default" }),
    });
    setResults((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto" style={{ color: LC.text }}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest" style={{ color: LC.textMuted }}>
        <Brain size={13} /> Supermemory
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") search(); }}
          placeholder="Search memories..."
          className="flex-1 rounded-lg border px-3 py-1.5 text-xs outline-none"
          style={{ backgroundColor: LC.bgSecondary, borderColor: LC.border, color: LC.text }}
        />
        <button onClick={search}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold"
          style={{ backgroundColor: `${LC.accentCyan}20`, color: LC.accentCyan, border: `1px solid ${LC.accentCyan}30` }}
        >
          {loading ? <RefreshCw size={12} className="animate-spin" /> : <Search size={12} />}
        </button>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {results.map((r, i) => (
            <div key={r.id || i}
              className="flex items-start justify-between gap-2 rounded-lg border p-2.5 text-xs"
              style={{ borderColor: LC.border, backgroundColor: LC.bgSecondary }}
            >
              <p className="flex-1 leading-relaxed" style={{ color: LC.text }}>{r.content}</p>
              <button onClick={() => forget(r.id, r.content)}
                className="shrink-0 rounded p-1 opacity-40 hover:opacity-100 transition-opacity"
                style={{ color: "#ff4444" }}
              ><Trash2 size={10} /></button>
            </div>
          ))}
        </div>
      )}
      {results.length === 0 && query && !loading && (
        <p className="text-xs opacity-40 text-center py-4" style={{ color: LC.textMuted }}>No memories found for &ldquo;{query}&rdquo;</p>
      )}

      {/* Add new memory */}
      <div className="mt-auto flex flex-col gap-2 pt-2 border-t" style={{ borderColor: LC.border }}>
        <div className="text-[10px] uppercase tracking-widest" style={{ color: LC.textMuted }}>Add Memory</div>
        <textarea
          value={newMem}
          onChange={(e) => setNewMem(e.target.value)}
          placeholder="Something to remember..."
          rows={3}
          className="w-full rounded-lg border px-3 py-2 text-xs outline-none resize-none"
          style={{ backgroundColor: LC.bgSecondary, borderColor: LC.border, color: LC.text }}
        />
        {status && <p className="text-[10px]" style={{ color: LC.accentCyan }}>{status}</p>}
        <button onClick={save} disabled={saving || !newMem.trim()}
          className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold disabled:opacity-40"
          style={{ backgroundColor: LC.accentCyan, color: "#000" }}
        >
          {saving ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />} Save to Memory
        </button>
      </div>
    </div>
  );
}
