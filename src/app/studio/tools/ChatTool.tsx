"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Brain,
  Hammer,
  Loader2,
  Sparkles,
} from "lucide-react";
import {
  buildStudioActionPrompt,
  STUDIO_ACTIONS,
  type StudioActionContext,
  type StudioActionId,
} from "@/lib/studio-actions";

type Message = { role: "user" | "assistant"; content: string };

export default function ChatTool() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const browserErrorsRef = useRef<string[]>([]);

  useEffect(() => {
    const recordError = (message: string) => {
      browserErrorsRef.current = [message, ...browserErrorsRef.current].slice(0, 8);
    };
    const onError = (event: ErrorEvent) => recordError(event.message || "Browser error");
    const onRejection = (event: PromiseRejectionEvent) =>
      recordError(event.reason instanceof Error ? event.reason.message : String(event.reason));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  const collectContext = useCallback((userGoal?: string): StudioActionContext => {
    const width = window.innerWidth;
    const selectedNode = document.querySelector<HTMLElement>("[data-studio-selected='true']");
    const visibleText = Array.from(
      new Set(
        (document.querySelector("main")?.textContent ?? "")
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length >= 3 && line.length <= 120),
      ),
    ).slice(0, 30);
    const route = `${window.location.pathname}${window.location.search}`;
    const relatedFiles = window.location.pathname.startsWith("/studio")
      ? [
          "src/app/studio/page.tsx",
          "src/app/studio/tools/ChatTool.tsx",
          "src/app/studio/components/StudioCommandDock.tsx",
        ]
      : [];
    return {
      route,
      projectId: window.localStorage.getItem("litlabs-active-project") || "litlabs-website",
      viewport: {
        width,
        height: window.innerHeight,
        device: width < 640 ? "mobile" : width < 1024 ? "tablet" : "desktop",
      },
      selectedElement: selectedNode
        ? {
            label:
              selectedNode.getAttribute("aria-label") ||
              selectedNode.dataset.studioLabel ||
              selectedNode.textContent?.trim().slice(0, 80) ||
              "selected interface element",
            componentName: selectedNode.dataset.component,
            sourceFile: selectedNode.dataset.sourceFile,
          }
        : undefined,
      visibleText,
      consoleErrors: browserErrorsRef.current,
      relatedFiles,
      activeAgent: "LiTT-Code",
      userGoal,
    };
  }, []);

  const send = useCallback(async (
    value: string,
    requestedAgent: "auto" | "litt-code" | "little-bit" = "auto",
    displayValue = value,
  ) => {
    const text = value.trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user" as const, content: displayValue }];
    setMessages(next);
    setBusy(true);
    try {
      const response = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentSlug: requestedAgent === "litt-code" ? "forge" : "director",
          provider: "gemini",
          message: text,
          history: messages,
          stream: false,
        }),
      });
      if (!response.ok) throw new Error("LiTT is reconnecting");
      const data = await response.json();
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            data.response ||
            data.text ||
            data.message ||
            data.content ||
            "I’m ready. Tell me what we’re building.",
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            error instanceof Error ? error.message : "LiTT is reconnecting",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }, [busy, messages]);

  const runStudioAction = (actionId: StudioActionId, label: string) => {
    const prompt = buildStudioActionPrompt(actionId, collectContext(label));
    void send(prompt, "litt-code", label);
  };

  useEffect(() => {
    const handleCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string; agent?: "auto" | "litt-code" | "little-bit" }>).detail;
      if (detail?.text) void send(detail.text, detail.agent);
    };
    window.addEventListener("litt:studio-command", handleCommand);
    return () => window.removeEventListener("litt:studio-command", handleCommand);
  }, [send]);

  return (
    <div className="relative mx-auto flex min-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-cyan-400/10 bg-[#050914] text-slate-100 shadow-2xl">
      <div
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "linear-gradient(rgba(34,211,238,.025) 1px, transparent 1px),linear-gradient(90deg,rgba(34,211,238,.025) 1px,transparent 1px),radial-gradient(circle at 50% 38%,rgba(16,185,129,.12),transparent 28%)",
          backgroundSize: "22px 22px,22px 22px,100% 100%",
        }}
      />
      <header className="relative flex items-center justify-between border-b border-white/10 px-3 py-2.5">
        <div className="flex items-center gap-2 text-[10px] font-black tracking-wider">
          <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-300 shadow-[0_0_8px_#22d3ee]" />
          <Bot size={13} className="text-cyan-300" /> LiTT Code Agent{" "}
          <span className="text-emerald-400">LIVE</span>
        </div>
        <div className="flex gap-2">
          <button className="rounded-full border border-white/10 px-3 py-1.5 text-[10px]">
            ＋ New
          </button>
          <button className="rounded-full border border-white/10 px-3 py-1.5 text-[10px]">
            ◉ Backdrop
          </button>
        </div>
      </header>

      <main className="relative flex flex-1 flex-col overflow-y-auto p-3 sm:p-5">
        {messages.length === 0 ? (
          <div className="m-auto w-full max-w-3xl py-8 text-center">
            <div className="mx-auto mb-3 grid h-20 w-20 place-items-center rounded-3xl border border-emerald-400/30 bg-emerald-400/10 text-emerald-300 shadow-[0_0_30px_rgba(16,185,129,.24)]">
              <Bot size={42} />
            </div>
            <h1 className="font-mono text-xl font-black sm:text-2xl">
              LiTT at the LiTT Code
            </h1>
            <p className="mt-1 font-mono text-[10px] text-slate-400 sm:text-xs">
              Your visible AI companion for building, memory, agents, and
              deploys.
            </p>
            <p className="mt-2 font-mono text-[9px] font-black tracking-[.25em] text-cyan-300">
              • COMPANIONS READY
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 text-left sm:grid-cols-4">
              {[
                [Bot, "LiT", "guide"],
                [Hammer, "Forge", "build"],
                [Sparkles, "Visionary", "design"],
                [Brain, "Memory", "recall"],
              ].map(([Icon, name, role]) => {
                const I = Icon as typeof Bot;
                return (
                  <button
                    key={String(name)}
                    className="rounded-xl border border-white/10 bg-white/3 p-2.5"
                  >
                    <span className="flex items-center gap-2">
                      <I size={15} className="text-cyan-300" />
                      <b className="font-mono text-[11px]">{String(name)}</b>
                    </span>
                    <span className="ml-6 font-mono text-[9px] text-slate-500">
                      {String(role)}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 grid grid-cols-1 gap-2 text-left sm:grid-cols-2">
              {STUDIO_ACTIONS.map((action) => (
                <button
                  key={action.id}
                  onClick={() => runStudioAction(action.id, action.label)}
                  className="group rounded-xl border border-white/10 bg-white/[.025] px-3 py-2.5 text-left transition-all hover:border-cyan-300/35 hover:bg-cyan-300/[.05]"
                >
                  <span className="block font-mono text-[10px] font-black text-slate-200 group-hover:text-cyan-200">
                    {action.label}
                  </span>
                  <span className="mt-0.5 block font-mono text-[8px] leading-relaxed text-slate-500">
                    {action.shortDescription}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 py-4">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`max-w-[88%] rounded-2xl border px-3 py-2.5 text-xs leading-relaxed ${message.role === "user" ? "ml-auto border-cyan-400/25 bg-cyan-400/10" : "border-white/10 bg-white/[.035]"}`}
              >
                {message.content}
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-[10px] text-cyan-300">
                <Loader2 size={13} className="animate-spin" /> LiTT is thinking…
              </div>
            )}
          </div>
        )}
      </main>

    </div>
  );
}
