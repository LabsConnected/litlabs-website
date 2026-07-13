"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { AGENTS } from "@/lib/agents";
import { AGENT_AVATAR_META } from "@/lib/avatars";
import { Bot, MessageSquare, ArrowRight, Terminal } from "lucide-react";

type StatusData = Record<string, { status: string; lastAction?: string }>;

export default function AgentsPageClient() {
  const { resolvedColors: T } = useTheme();
  const [statusData, setStatusData] = useState<StatusData>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/agents/status");
        const data = await res.json();
        if (alive) {
          setStatusData(data.agents || data);
          setLoading(false);
        }
      } catch {
        if (alive) setLoading(false);
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  const list = Object.values(AGENTS).filter((a) => a.id !== "pixel-forge");

  return (
    <main
      className="h-full overflow-y-auto pb-20"
      style={{ backgroundColor: T.bgColor, color: T.textColor }}
    >
      <section className="max-w-7xl mx-auto px-4 pt-8 pb-6">
        <div className="flex items-center gap-3 mb-2">
          <div
            className="w-10 h-10 rounded-2xl flex items-center justify-center"
            style={{
              backgroundColor: T.accentColor + "15",
              border: `1px solid ${T.accentColor}30`,
            }}
          >
            <Bot size={20} style={{ color: T.accentColor }} />
          </div>
          <div>
            <h1
              className="text-2xl font-black"
              style={{ color: T.headerColor }}
            >
              LiTTree-LabStudios
            </h1>
            <p className="text-xs" style={{ color: T.textMuted }}>
              LiTT Command Center — 2 consolidated AI agents, live status &
              quick access
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 mt-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {loading &&
            Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="h-56 rounded-3xl border animate-pulse"
                style={{
                  backgroundColor: T.boxBg,
                  borderColor: T.borderColor + "20",
                }}
              />
            ))}
          {!loading &&
            list.map((agent) => {
              const meta = AGENT_AVATAR_META[agent.id];
              const status = statusData[agent.id];
              const isRunning = status?.status === "running";
              const statusColor = isRunning ? "#22d3ee" : "#34d399";
              const statusLabel = isRunning ? "Working" : "Ready";
              const emoji = meta?.emoji || "🤖";
              const bg = meta?.bg || agent.color + "18";

              return (
                <article
                  key={agent.id}
                  className="group rounded-3xl border p-5 transition-transform duration-200 hover:-translate-y-1"
                  style={{
                    backgroundColor: T.boxBg,
                    borderColor: T.borderColor + "25",
                  }}
                >
                  <div className="flex items-start justify-between">
                    <div
                      className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl"
                      style={{
                        backgroundColor: bg,
                        border: `1px solid ${agent.color}30`,
                      }}
                    >
                      {emoji}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full animate-pulse"
                        style={{ backgroundColor: statusColor }}
                      />
                      <span
                        className="text-[10px] font-black uppercase tracking-[0.24em]"
                        style={{ color: statusColor }}
                      >
                        {statusLabel}
                      </span>
                    </div>
                  </div>

                  <h2
                    className="mt-4 text-2xl font-black"
                    style={{ color: T.headerColor }}
                  >
                    {agent.name}
                  </h2>
                  <p
                    className="mt-1 text-[11px] font-bold uppercase tracking-[0.24em]"
                    style={{ color: T.textMuted }}
                  >
                    {agent.role}
                  </p>
                  <p
                    className="mt-4 text-sm leading-relaxed"
                    style={{ color: T.textColor }}
                  >
                    {status?.lastAction || agent.personality}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-1">
                    {agent.domains.slice(0, 4).map((d) => (
                      <span
                        key={d}
                        className="text-[9px] px-2 py-0.5 rounded-full font-bold capitalize"
                        style={{
                          backgroundColor: agent.color + "15",
                          color: agent.color,
                        }}
                      >
                        {d}
                      </span>
                    ))}
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <Link
                      href={`/agents/${agent.id}`}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-bold"
                      style={{
                        backgroundColor: agent.color + "15",
                        color: agent.color,
                        border: `1px solid ${agent.color}30`,
                      }}
                    >
                      <MessageSquare size={14} /> Chat
                    </Link>
                    <Link
                      href="/studio?tool=agents"
                      className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-bold"
                      style={{
                        backgroundColor: T.bgColor + "60",
                        color: T.textMuted,
                        border: `1px solid ${T.borderColor}30`,
                      }}
                    >
                      <Terminal size={14} /> Open
                    </Link>
                  </div>
                </article>
              );
            })}
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 mt-8">
        <div
          className="rounded-3xl border p-5 md:p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
          style={{
            background:
              "linear-gradient(135deg, rgba(34,211,238,0.08), rgba(249,115,22,0.06))",
            borderColor: T.borderColor + "25",
          }}
        >
          <div>
            <div
              className="text-xs font-black uppercase tracking-[0.24em]"
              style={{ color: T.accentColor }}
            >
              Next step
            </div>
            <p className="mt-2 text-sm opacity-80">
              Use the agent cards to chat, or launch the Studio agents tool for
              a more hands-on workspace.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/studio?tool=agents"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-black"
              style={{
                backgroundColor: T.accentColor,
                color: T.bgColor,
              }}
            >
              Launch Studio <ArrowRight size={14} />
            </Link>
            <Link
              href="/gallery"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold"
              style={{
                backgroundColor: T.boxBg + "50",
                color: T.textColor,
                border: `1px solid ${T.borderColor}30`,
              }}
            >
              Browse Gallery
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
