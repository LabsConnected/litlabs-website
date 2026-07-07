"use client";

import Link from "next/link";
import { Terminal, FileCode, Logs, Rocket, Bot, ScanLine, ArrowRight } from "lucide-react";

const tools = [
  { icon: Terminal, label: "Terminal Control" },
  { icon: ScanLine, label: "Project Scanner" },
  { icon: FileCode, label: "Code Fixes" },
  { icon: Bot, label: "Agent Workflows" },
  { icon: Logs, label: "Log Analysis" },
  { icon: Rocket, label: "Deploy" },
];

export function LiTTreeFeaturedCard() {
  return (
    <div className="rounded-2xl border border-orange-500/30 bg-black p-6 shadow-[0_0_40px_rgba(249,115,22,0.12)]">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-orange-500">
            Flagship System Agent
          </p>
          <h2 className="mt-1 text-3xl font-black text-white">LiTTree Core</h2>
          <p className="mt-1 text-sm text-neutral-400">
            Your main AI brain for building, creating, selling, and automating. One tree. Many agents.
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-green-500/10 px-3 py-1 text-sm font-bold text-green-400">
          <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
          Online
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tools.map((tool) => {
          const Icon = tool.icon;
          return (
            <div
              key={tool.label}
              className="flex items-center gap-2 rounded-xl bg-neutral-950 p-3 text-sm text-neutral-300"
            >
              <Icon className="h-4 w-4 text-orange-400" />
              {tool.label}
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <Link
          href="/studio?tool=chat"
          className="flex items-center gap-2 rounded-xl bg-orange-600 px-5 py-3 font-bold text-white transition hover:bg-orange-500"
        >
          <Terminal className="h-4 w-4" />
          Open LiTTree Core
        </Link>
        <Link
          href="/agents/director"
          className="flex items-center gap-2 rounded-xl border border-neutral-700 px-5 py-3 font-bold text-white transition hover:border-orange-500 hover:text-orange-400"
        >
          View LiTTree Profile
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
