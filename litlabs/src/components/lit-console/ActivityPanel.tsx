"use client";

import { useEffect, useState } from "react";
import { useLitConsoleTheme } from "./useLitConsoleTheme";
import { Brain, FileText, Activity, Cpu, Zap, ChevronRight } from "lucide-react";

interface ActivityPanelProps {
  loading?: boolean;
  activeAgent?: string;
  activeModel?: string;
  memoryCount?: number;
  lastUserIntent?: string;
}

interface LogItem {
  id: string;
  type: "thought" | "file" | "skill" | "memory";
  text: string;
  ts: number;
}

export default function ActivityPanel({
  loading,
  activeAgent = "LiTTree",
  activeModel = "Gemini 2.5 Flash",
  memoryCount = 0,
  lastUserIntent,
}: ActivityPanelProps) {
  const LC = useLitConsoleTheme();
  const [logs, setLogs] = useState<LogItem[]>([]);

  useEffect(() => {
    if (!loading) {
      setLogs([]);
      return;
    }
    const steps = [
      { type: "thought" as const, text: "Reading user intent..." },
      { type: "memory" as const, text: "Recalled recent conversation context" },
      { type: "file" as const, text: "Opened project manifest" },
      { type: "skill" as const, text: "Activated Code Fixer skill" },
      { type: "file" as const, text: "Read src/app/studio/page.tsx" },
      { type: "thought" as const, text: "Planning next edit..." },
    ];
    let i = 0;
    setLogs([]);
    const interval = setInterval(() => {
      setLogs((prev) => {
        const next = steps[i % steps.length];
        const id = `${next.type}-${Date.now()}-${i}`;
        return [...prev.slice(-8), { ...next, id, ts: Date.now() }];
      });
      i++;
    }, 900);
    return () => clearInterval(interval);
  }, [loading]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden" style={{ backgroundColor: LC.bg }}>
      <div
        className="flex items-center justify-between border-b px-3 py-2"
        style={{ borderColor: LC.border }}
      >
        <div className="flex items-center gap-2 text-xs font-black" style={{ color: LC.text }}>
          <Activity size={13} style={{ color: LC.accentCyan }} />
          Live Activity
        </div>
        {loading && (
          <span
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold"
            style={{ backgroundColor: `${LC.accentCyan}15`, color: LC.accentCyan }}
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: LC.accentCyan }} />
            Working
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Agent status */}
        <div
          className="rounded-xl border p-3"
          style={{ backgroundColor: LC.bgPanel, borderColor: LC.border }}
        >
          <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-wider" style={{ color: LC.textMuted }}>
            <Cpu size={11} /> Agent
          </div>
          <div className="flex items-center gap-2">
            <div
              className="flex h-6 w-6 items-center justify-center rounded-full"
              style={{ backgroundColor: `${LC.accentCyan}15`, color: LC.accentCyan }}
            >
              <Zap size={12} />
            </div>
            <div>
              <div className="text-xs font-bold" style={{ color: LC.text }}>{activeAgent}</div>
              <div className="text-[9px]" style={{ color: LC.textMuted }}>{activeModel}</div>
            </div>
          </div>
        </div>

        <div
          className="rounded-xl border p-3"
          style={{ backgroundColor: LC.bgPanel, borderColor: LC.border }}
        >
          <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-wider" style={{ color: LC.textMuted }}>
            <Brain size={11} /> Working Context
          </div>
          <div className="space-y-2 text-[11px]" style={{ color: LC.textDim }}>
            <div className="rounded-lg px-2 py-1.5" style={{ backgroundColor: LC.bgSecondary }}>
              Mission: make AI easy to use, useful, and fun without setup hassle.
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Recent turns in view</span>
              <span className="font-bold" style={{ color: LC.accentCyan }}>{memoryCount}</span>
            </div>
            {lastUserIntent && (
              <div className="line-clamp-3 rounded-lg px-2 py-1.5" style={{ backgroundColor: LC.bgSecondary, color: LC.textMuted }}>
                {lastUserIntent}
              </div>
            )}
          </div>
        </div>

        {/* Activity stream */}
        <div>
          <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-wider" style={{ color: LC.textMuted }}>
            <Brain size={11} /> Brain Stream
          </div>
          {logs.length === 0 ? (
            <div
              className="rounded-xl border p-4 text-center text-[10px]"
              style={{ backgroundColor: LC.bgPanel, borderColor: LC.border, color: LC.textDim }}
            >
              Waiting for activity...
            </div>
          ) : (
            <div className="space-y-1.5">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start gap-2 rounded-lg border p-2 text-[10px] animate-in fade-in slide-in-from-right-2 duration-200"
                  style={{ backgroundColor: LC.bgPanel, borderColor: LC.border }}
                >
                  {log.type === "thought" && <Brain size={11} style={{ color: LC.accentCyan }} />}
                  {log.type === "file" && <FileText size={11} style={{ color: LC.accentOrange }} />}
                  {log.type === "skill" && <Zap size={11} style={{ color: "#fbbf24" }} />}
                  {log.type === "memory" && <Cpu size={11} style={{ color: "#a78bfa" }} />}
                  <span className="flex-1" style={{ color: LC.textDim }}>{log.text}</span>
                  <ChevronRight size={10} style={{ color: LC.textMuted }} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
