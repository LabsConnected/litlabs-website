"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Play, Search, Plus, Trash2, RefreshCw, ExternalLink, Brain, FolderOpen, Bot } from "lucide-react";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import ChatPanel, { Message } from "./ChatPanel";
import CommandDock, { MODELS } from "./CommandDock";
import DrawerPanel from "./DrawerPanel";
import ApprovalCard from "./ApprovalCard";
import RunTimeline from "./RunTimeline";
import {
  LiTTreeTerminal,
  LiTTreeTerminalHandle,
} from "@/components/terminal/LiTTreeTerminal";
import { useLitConsoleTheme } from "./useLitConsoleTheme";
import type { LiTContext } from "@/lib/jarvis-context";
import type { LiTTipResult } from "@/lib/lit-tip";
import { useLiTVoice } from "@/hooks/useLiTVoice";
import LiveVoicePanel from "./LiveVoicePanel";
import ConnectorsPanel from "./ConnectorsPanel";
import ActivityPanel from "./ActivityPanel";
import { detectIntent, buildNavigationMessage } from "@/lib/intent-router";
import { actionFromIntent, actionMessage, executeAction } from "@/lib/lit-actions";
import type { DirectorStep, DirectorRunStatus, DirectorRunResponse, ExecuteStepResponse } from "@/lib/director/types";

const initialContext: LiTContext = {
  route: "/studio?tool=chat",
  terminalOutput: "",
  commandHistory: [],
  logs: [],
  fileTree: [],
  agents: [{ name: "LiT", status: "online" }],
  websocketStatus: "connected",
};

type DrawerTab = "terminal" | "files" | "preview" | "agents" | "memory" | "connectors" | "holo";

export default function LitConsole() {
  const { user } = useUser();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("terminal");
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
  // Director Run Execution Loop state
  const [activeRun, setActiveRun] = useState<{
    runId: string;
    goal: string;
    steps: DirectorStep[];
    status: DirectorRunStatus;
    currentStepId?: string;
  } | null>(null);
  const [approvalStep, setApprovalStep] = useState<DirectorStep | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [holoUrl, setHoloUrl] = useState("");
  const [holoTitle, setHoloTitle] = useState("");
  const LC = useLitConsoleTheme();
  const termRef = useRef<LiTTreeTerminalHandle>(null);

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
          model: activeModel,
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

      const navAction = data.actions?.find(
        (a: { type: string; url?: string }) =>
          a.type === "navigate" && a.url,
      );
      if (navAction?.url) {
        const url = navAction.url!;
        if (url.startsWith("/")) {
          setTimeout(() => router.push(url), 600);
        } else {
          setTimeout(() => {
            setHoloUrl(url);
            setHoloTitle(url.split("/").pop() || "Holo View");
            setDrawerTab("holo");
            setDrawerOpen(true);
          }, 600);
        }
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
  }, [user, activeModel, router]);

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

      const intent = detectIntent(t);
      if (intent.route && !intent.isAmbiguous) {
        const action = actionFromIntent(t, {
          route: { path: intent.route.path, label: intent.route.label },
          confidence: intent.confidence,
          isAmbiguous: intent.isAmbiguous,
        });
        const currentRoute = typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "";
        const isChatPage = currentRoute.startsWith("/studio");
        const skipOnChat = action && ["build_app", "create_agent"].includes(action.type) && isChatPage;

        if (action && action.type !== "navigate" && !skipOnChat) {
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

        const routePath = intent.route!.path;
        const currentRoute = typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "";
        const isSamePage = routePath === currentRoute || routePath === "/studio?tool=chat" && currentRoute.startsWith("/studio");

        if (!isSamePage) {
          const navMsg = buildNavigationMessage(intent);
          setMessages((prev) => [
            ...prev,
            {
              id: Math.random().toString(36).slice(2),
              role: "lit",
              content: navMsg,
            },
          ]);
          if (routePath.startsWith("/")) {
            setTimeout(() => router.push(routePath), 800);
          } else {
            setTimeout(() => {
              setHoloUrl(routePath);
              setHoloTitle(intent.route!.label || "Holo View");
              setDrawerTab("holo");
              setDrawerOpen(true);
            }, 800);
          }
          setLoading(false);
          return;
        }

        // Already on the right page — fall through to askLiT so it actually does the work
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

  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;
  const onVoiceTranscript = useCallback((text: string) => handleSendRef.current(text), []);

  const {
    state: voiceState,
    transcript: voiceTranscript,
    isSupported: voiceSupported,
    voices,
    selectedVoice,
    rate,
    pitch,
    continuous,
    setVoice,
    setRate,
    setPitch,
    setContinuous,
    startListening,
    stopListening,
    stopSpeaking,
    speak,
  } = useLiTVoice({
    onTranscript: onVoiceTranscript,
  });

  const lastSpokenIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!speak) return;
    const lastLit = [...messages].reverse().find((m) => m.role === "lit");
    if (!lastLit || lastLit.id === lastSpokenIdRef.current) return;
    lastSpokenIdRef.current = lastLit.id;
    speak(lastLit.content.replace(/\n/g, " ").slice(0, 250));
  }, [messages, speak]);

  // ── Director Run Execution Loop ──────────────────────────────────
  const executeDirectorStep = useCallback(async (runId: string, stepId: string) => {
    setActiveRun((prev) => prev ? { ...prev, currentStepId: stepId, status: "running" } : prev);
    setApprovalStep(null);
    setMessages((prev) => [...prev, { id: Math.random().toString(36).slice(2), role: "tool", content: "Executing step...", meta: { tool: "think", status: "running" } }]);
    try {
      const res = await fetch("/api/director/execute-step", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, stepId }),
      });
      const data: ExecuteStepResponse & { ok: boolean } = await res.json();
      if (!data.ok) throw new Error(data.step?.error || "Step execution failed");
      setActiveRun((prev) => {
        if (!prev) return prev;
        return {
          ...prev, status: data.runStatus, currentStepId: data.nextAction?.id || undefined,
          steps: prev.steps.map((s) => s.id === stepId ? { ...s, status: data.step.status, result: data.step.result, error: data.step.error } : s),
        };
      });
      setMessages((prev) => prev.map((m) => m.meta?.tool === "think" ? { ...m, meta: { ...m.meta, status: "done" } } : m));
      const stepResult = data.step.result ? data.step.result.slice(0, 500) : "No output";
      setMessages((prev) => [...prev, { id: Math.random().toString(36).slice(2), role: "system", content: `✅ ${data.step.title}: ${stepResult}` }]);
      if (data.nextAction?.requiresApproval) {
        setApprovalStep(data.nextAction);
        setMessages((prev) => [...prev, { id: Math.random().toString(36).slice(2), role: "system", content: `Step "${data.nextAction!.title}" requires approval.` }]);
      } else if (data.nextAction) {
        executeDirectorStep(runId, data.nextAction.id);
      } else if (data.runStatus === "completed") {
        setMessages((prev) => [...prev, { id: Math.random().toString(36).slice(2), role: "lit", content: "Run completed successfully. All steps finished." }]);
      } else if (data.runStatus === "failed") {
        setMessages((prev) => [...prev, { id: Math.random().toString(36).slice(2), role: "lit", content: "Run failed. Check step details for errors." }]);
      }
    } catch (err) {
      setMessages((prev) => prev.map((m) => m.meta?.tool === "think" ? { ...m, meta: { ...m.meta, status: "error" } } : m));
      setMessages((prev) => [...prev, { id: Math.random().toString(36).slice(2), role: "lit", content: err instanceof Error ? err.message : "Step execution failed." }]);
      setActiveRun((prev) => prev ? { ...prev, status: "failed" } : prev);
    }
  }, []);

  const handleDirectorRun = useCallback(async (text: string) => {
    if (!text.trim() || isRunning) return;
    setIsRunning(true); setActiveRun(null); setApprovalStep(null);
    setMessages((prev) => [...prev,
      { id: Math.random().toString(36).slice(2), role: "user", content: text },
      { id: Math.random().toString(36).slice(2), role: "tool", content: "Director is planning...", meta: { tool: "think", status: "running" } },
    ]);
    setInput("");
    try {
      const res = await fetch("/api/director/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, mode: "act", autoApprove: false }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Director planning failed");
      const run: DirectorRunResponse = data;
      setActiveRun({ runId: run.runId, goal: run.plan.goal, steps: run.plan.steps, status: run.status });
      setMessages((prev) => prev.map((m) => m.meta?.tool === "think" ? { ...m, meta: { ...m.meta, status: "done" } } : m));
      if (run.nextAction?.requiresApproval) {
        setApprovalStep(run.nextAction);
        setMessages((prev) => [...prev, { id: Math.random().toString(36).slice(2), role: "system", content: `Step "${run.nextAction!.title}" requires approval.` }]);
      } else if (run.nextAction) {
        executeDirectorStep(run.runId, run.nextAction.id);
      }
    } catch (err) {
      setMessages((prev) => prev.map((m) => m.meta?.tool === "think" ? { ...m, meta: { ...m.meta, status: "error" } } : m));
      setMessages((prev) => [...prev, { id: Math.random().toString(36).slice(2), role: "lit", content: err instanceof Error ? err.message : "Director run failed." }]);
    } finally { setIsRunning(false); }
  }, [isRunning, executeDirectorStep]);

  const handleApproveStep = useCallback((stepId: string) => {
    if (!activeRun) return;
    setActiveRun((prev) => prev ? { ...prev, steps: prev.steps.map((s) => s.id === stepId ? { ...s, status: "approved" } : s) } : prev);
    setApprovalStep(null);
    executeDirectorStep(activeRun.runId, stepId);
  }, [activeRun, executeDirectorStep]);

  const handleRejectStep = useCallback((stepId: string) => {
    if (!activeRun) return;
    setActiveRun((prev) => prev ? { ...prev, steps: prev.steps.map((s) => s.id === stepId ? { ...s, status: "skipped" } : s) } : prev);
    setApprovalStep(null);
    setMessages((prev) => [...prev, { id: Math.random().toString(36).slice(2), role: "system", content: `Skipped step.` }]);
    const nextStep = activeRun.steps.find((s) => s.status === "pending" && s.id !== stepId);
    if (nextStep) executeDirectorStep(activeRun.runId, nextStep.id);
  }, [activeRun, executeDirectorStep]);

  // Legacy pending command approval (used by /api/jarvis/think responses)
  const approveCommand = useCallback((command: string) => {
    if (!command) return;
    setMessages((prev) => [...prev, { id: Math.random().toString(36).slice(2), role: "system", content: `Running: \`${command}\`` }]);
    setDrawerOpen(true);
    setDrawerTab("terminal");
    setTimeout(() => termRef.current?.runCommand(command), 300);
    setPendingCommand(null);
  }, []);

  const handleApprove = useCallback(() => {
    if (!pendingCommand) return;
    approveCommand(pendingCommand);
  }, [approveCommand, pendingCommand]);

  const handleRun = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || loading) return;
      handleDirectorRun(text);
    },
    [input, loading, handleDirectorRun],
  );

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
    if (drawerTab === "connectors") return <ConnectorsPanel onClose={() => setDrawerOpen(false)} />;
    if (drawerTab === "holo") return <HoloView url={holoUrl} title={holoTitle} />;
    return <MemoryPanel />;
  })();

  return (
    <div className="flex h-full w-full flex-col" style={{ backgroundColor: LC.bg }}>
      {/* Main content area — chat + live activity panel */}
      <div className="relative flex min-h-0 flex-1 flex-row overflow-hidden">
        {/* Desktop: chat + side panel */}
        <div className="hidden md:flex flex-1 min-h-0 flex-row overflow-hidden">
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden lg:p-5">
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
          <div
            className="hidden lg:block w-[340px] shrink-0 border-l overflow-hidden"
            style={{ borderColor: LC.border }}
          >
            <ActivityPanel
              loading={loading}
              activeAgent={activeAgent}
              activeModel={MODELS.find((m) => m.id === activeModel)?.label || activeModel}
            />
          </div>
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

      {/* ── Director Run Timeline ── */}
      {activeRun && (
        <div className="mx-4 mb-2 mt-2">
          <RunTimeline
            goal={activeRun.goal}
            steps={activeRun.steps}
            runStatus={activeRun.status}
            currentStepId={activeRun.currentStepId}
            theme={LC}
          />
        </div>
      )}

      {/* ── Approval Card ── */}
      {approvalStep && (
        <div className="mx-4 mb-2">
          <ApprovalCard
            step={approvalStep}
            onApprove={handleApproveStep}
            onReject={handleRejectStep}
            theme={LC}
          />
        </div>
      )}

      {/* Command dock always at bottom */}
      <CommandDock
        value={input}
        onChange={setInput}
        onSend={() => handleSend()}
        onRun={(text) => handleDirectorRun(text)}
        isRunning={isRunning}
        litTip={litTip}
        agent={activeAgent}
        model={activeModel}
        onAgentChange={handleAgentChange}
        onModelChange={handleModelChange}
        onFileSelect={async (file) => {
          const id = Math.random().toString(36).slice(2);
          setMessages((prev) => [
            ...prev,
            {
              id,
              role: "user",
              content: `Attached: ${file.name}`,
              attachment: { name: file.name, url: URL.createObjectURL(file), type: file.type },
            },
          ]);
          try {
            const form = new FormData();
            form.append("file", file);
            const res = await fetch("/api/upload", { method: "POST", body: form });
            const data = await res.json();
            if (data.url) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === id
                    ? { ...m, attachment: { name: file.name, url: data.url, type: file.type } }
                    : m,
                ),
              );
              // Save uploaded asset to Supermemory so LiT can recall it later
              fetch("/api/memory", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  content: `User uploaded ${file.name}: ${data.url}`,
                  userId: user?.id || "default",
                  metadata: { type: "attachment", name: file.name, url: data.url, mimeType: file.type },
                }),
              }).catch(() => {});
              askLiT(`I uploaded ${file.name}. URL: ${data.url}`);
            } else {
              throw new Error(data.error || "Upload failed");
            }
          } catch (err) {
            setMessages((prev) => [
              ...prev,
              {
                id: Math.random().toString(36).slice(2),
                role: "system",
                content: err instanceof Error ? err.message : "Upload failed.",
              },
            ]);
          }
        }}
        onTools={() => setDrawerOpen((v) => !v)}
        onConnectors={() => {
          if (drawerOpen && drawerTab === "connectors") {
            setDrawerOpen(false);
          } else {
            setDrawerTab("connectors");
            setDrawerOpen(true);
          }
        }}
        onToggleTerminal={() => {
          setDrawerTab("terminal");
          setDrawerOpen((v) => !v);
        }}
        onCreateFile={() => handleSend("Create a new file")}
        onBuild={() => handleSend("Build the project")}
        onGenerateMedia={() => handleSend("Generate an image")}
        onDeploy={() => handleSend("Run: npx vercel --prod to deploy the current project")}
        onSaveWorkflow={() => handleSend("Save this workflow as a reusable automation")}
        onVoice={() => setVoiceOpen(true)}
        onVoiceStop={() => {
          stopListening();
          stopSpeaking();
          setVoiceOpen(false);
        }}
        voiceState={voiceState}
      />

      {voiceOpen && (
        <LiveVoicePanel
          onClose={() => {
            stopListening();
            stopSpeaking();
            setVoiceOpen(false);
          }}
          state={voiceState}
          transcript={voiceTranscript}
          isSupported={voiceSupported}
          voices={voices}
          selectedVoice={selectedVoice}
          rate={rate}
          pitch={pitch}
          continuous={continuous}
          setVoice={setVoice}
          setRate={setRate}
          setPitch={setPitch}
          setContinuous={setContinuous}
          startListening={startListening}
          stopListening={stopListening}
          stopSpeaking={stopSpeaking}
        />
      )}


      {pendingCommand && (
        <div
          className="fixed bottom-36 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border px-4 py-2 text-xs font-semibold shadow-lg"
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

const STUDIO_TOOLS = [
  { id: "image", label: "Image Agent", href: "/studio?tool=chat", icon: "🎨" },
  { id: "video", label: "Video Studio", href: "/studio?tool=video", icon: "🎬" },
  { id: "audio", label: "Music Studio", href: "/studio?tool=audio", icon: "🎵" },
  { id: "agents", label: "LiTTree Agent", href: "/studio?tool=chat", icon: "🤖" },
  { id: "gallery", label: "Asset Gallery", href: "/studio?tool=gallery", icon: "🖼" },
  { id: "terminal", label: "Command Tools", href: "/studio?tool=chat", icon: "⚡" },
];

function FilesPanel({ onPrompt }: { onPrompt: (t: string) => void }) {
  const LC = useLitConsoleTheme();
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
  const LC = useLitConsoleTheme();
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
  const LC = useLitConsoleTheme();
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
  const LC = useLitConsoleTheme();
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
          {results.map((r, i) => {
            const imageUrl = r.content.match(/https?:\/\/[^\s]+\.(png|jpe?g|gif|webp|svg)/i)?.[0];
            return (
              <div key={r.id || i}
                className="flex flex-col gap-2 rounded-lg border p-2.5 text-xs"
                style={{ borderColor: LC.border, backgroundColor: LC.bgSecondary }}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="flex-1 leading-relaxed" style={{ color: LC.text }}>{r.content}</p>
                  <button onClick={() => forget(r.id, r.content)}
                    className="shrink-0 rounded p-1 opacity-40 hover:opacity-100 transition-opacity"
                    style={{ color: "#ff4444" }}
                  ><Trash2 size={10} /></button>
                </div>
                {imageUrl && (
                  <a href={imageUrl} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg border" style={{ borderColor: LC.border }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageUrl} alt="Memory attachment" className="max-h-40 w-auto object-contain" />
                  </a>
                )}
              </div>
            );
          })}
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

function HoloView({ url, title }: { url: string; title: string }) {
  const LC = useLitConsoleTheme();
  const isExternal = url.startsWith("http://") || url.startsWith("https://");
  return (
    <div className="flex h-full w-full flex-col gap-2">
      <div className="flex items-center justify-between rounded-lg border px-3 py-2" style={{ backgroundColor: LC.bgPanel, borderColor: LC.border }}>
        <div className="flex items-center gap-2 text-xs font-black" style={{ color: LC.accentCyan }}>
          <span className="h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: LC.accentCyan, boxShadow: `0 0 8px ${LC.accentCyan}` }} />
          HOLO · {title}
        </div>
        {isExternal && (
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold" style={{ color: LC.textMuted }}>
            Open ↗
          </a>
        )}
      </div>
      <div className="flex-1 overflow-hidden rounded-xl border" style={{ borderColor: `${LC.accentCyan}30`, boxShadow: `0 0 20px ${LC.accentCyan}08` }}>
        {isExternal ? (
          <iframe src={url} className="h-full w-full border-0" style={{ backgroundColor: "#fff" }} title={title} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center" style={{ color: LC.textMuted }}>
            <p>Internal content view</p>
            <p className="mt-2 text-xs opacity-50">{url}</p>
          </div>
        )}
      </div>
    </div>
  );
}
