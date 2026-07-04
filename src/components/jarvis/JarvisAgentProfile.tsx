"use client";

import Link from "next/link";
import { Terminal, Rocket, ScanLine, Play, ArrowLeft, Brain, Settings } from "lucide-react";
import { JarvisToolGrid } from "./JarvisToolGrid";
import { JarvisChatPanel } from "./JarvisChatPanel";

export function JarvisAgentProfile() {
  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <div className="border-b border-neutral-900 px-6 py-4">
        <div className="mx-auto max-w-6xl">
          <Link href="/agents" className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-white">
            <ArrowLeft className="h-3 w-3" /> Back to Agents
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-600/20 border border-orange-600/30">
                <Brain className="h-6 w-6 text-orange-400" />
              </div>
              <div>
                <h1 className="text-3xl font-black">Jarvis</h1>
                <p className="text-sm text-neutral-400">AI Dev OS Brain</p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-full bg-green-500/10 px-3 py-1 text-xs font-bold text-green-400">
                <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
                Online
              </span>
              <span className="rounded-full bg-neutral-900 px-3 py-1 text-xs font-bold text-neutral-400">
                System Agent
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/jarvis"
              className="flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-orange-500"
            >
              <Terminal className="h-4 w-4" />
              Open Jarvis Terminal
            </Link>
            <button
              onClick={() => window.location.href = "/jarvis"}
              className="flex items-center gap-2 rounded-xl border border-neutral-800 px-4 py-2.5 text-sm font-bold text-neutral-300 transition hover:border-orange-500 hover:text-orange-400"
            >
              <ScanLine className="h-4 w-4" />
              Run Scan
            </button>
            <Link
              href="/settings?tab=agents"
              className="flex items-center gap-2 rounded-xl border border-neutral-800 px-4 py-2.5 text-sm font-bold text-neutral-300 transition hover:border-neutral-600"
            >
              <Settings className="h-4 w-4" />
              Configure
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-6">
              <div className="mb-4">
                <h2 className="text-lg font-bold">About Jarvis</h2>
                <p className="mt-1 text-sm text-neutral-400">
                  Jarvis is the AI operating layer for LiTTree OS. It connects directly to your terminal,
                  file system, logs, command history, and agent workflows. Unlike a separate chatbot,
                  Jarvis understands your full development context and can take actionable steps.
                </p>
              </div>
              <JarvisToolGrid />
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-6">
              <h3 className="mb-3 text-xs font-black uppercase tracking-wider text-neutral-500">
                Quick Actions
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Link
                  href="/jarvis"
                  className="flex flex-col items-center gap-2 rounded-xl border border-neutral-800 p-4 text-xs font-bold text-neutral-300 transition hover:border-orange-500 hover:text-orange-400"
                >
                  <Terminal className="h-5 w-5" />
                  Open Terminal
                </Link>
                <Link
                  href="/jarvis"
                  className="flex flex-col items-center gap-2 rounded-xl border border-neutral-800 p-4 text-xs font-bold text-neutral-300 transition hover:border-orange-500 hover:text-orange-400"
                >
                  <ScanLine className="h-5 w-5" />
                  Run Scan
                </Link>
                <Link
                  href="/jarvis"
                  className="flex flex-col items-center gap-2 rounded-xl border border-neutral-800 p-4 text-xs font-bold text-neutral-300 transition hover:border-orange-500 hover:text-orange-400"
                >
                  <Play className="h-5 w-5" />
                  Start Workflow
                </Link>
                <Link
                  href="/jarvis"
                  className="flex flex-col items-center gap-2 rounded-xl border border-neutral-800 p-4 text-xs font-bold text-neutral-300 transition hover:border-orange-500 hover:text-orange-400"
                >
                  <Rocket className="h-5 w-5" />
                  Deploy
                </Link>
              </div>
            </div>
          </div>

          <div className="lg:sticky lg:top-4 lg:h-fit">
            <JarvisChatPanel compact />
          </div>
        </div>
      </div>
    </div>
  );
}
