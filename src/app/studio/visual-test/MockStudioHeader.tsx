"use client";

/**
 * MockStudioHeader — visual replica of CommandStudioHeader for the
 * visual test harness. Renders the same layout and status pills but
 * replaces Clerk's UserButton with a static avatar circle.
 *
 * This avoids requiring ClerkProvider in the visual test harness
 * (no auth bypass) while preserving visual fidelity.
 */

import { Sparkles, ChevronDown, Eye, Rocket } from "lucide-react";
import { useStudioModelStore } from "../stores/useStudioModelStore";
import type { ConnectionCapabilities } from "../hooks/useConnectionSummary";

export default function MockStudioHeader({
  branch,
  onPreview,
  onOpenActivity,
  projectReady,
  capabilities,
}: {
  branch?: string;
  onPreview?: () => void;
  onOpenActivity?: () => void;
  projectReady?: boolean;
  capabilities: ConnectionCapabilities;
}) {
  const selectedModel = useStudioModelStore((s) => s.selectedModel);

  const providerCount = capabilities.connectedProviders.length;
  const repoConnected = capabilities.repository === "connected";
  const ptyAvailable = capabilities.terminalExecution === "available";
  const hasProject = repoConnected || ptyAvailable;
  const hasAi = providerCount > 0;
  const statusColor = hasProject && hasAi
    ? "var(--litt-primary)"
    : hasProject
      ? "#e3b341"
      : "var(--text-muted)";
  const statusLabel = hasProject && hasAi
    ? "Workspace available"
    : hasProject
      ? "AI setup required"
      : hasAi
        ? "Project setup required"
        : "Workspace setup required";

  return (
    <header
      className="flex shrink-0 items-center gap-2 border-b px-2 sm:px-3"
      style={{
        height: "var(--studio-header-h)",
        backgroundColor: "var(--studio-bg)",
        borderColor: "var(--studio-border)",
      }}
    >
      {/* LiTT Studio logo */}
      <div className="flex shrink-0 items-center gap-1.5">
        <div
          className="grid h-6 w-6 place-items-center rounded-md"
          style={{
            background: "linear-gradient(135deg, var(--litt-primary), var(--spark-primary))",
          }}
          aria-hidden
        >
          <Sparkles size={11} className="text-black" />
        </div>
        <span
          className="hidden sm:inline text-[11px] font-black uppercase tracking-[0.15em]"
          style={{ color: "var(--text-primary)" }}
        >
          LiTT Studio
        </span>
      </div>

      {/* Branch */}
      {branch && (
        <span
          className="hidden md:inline shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-bold"
          style={{
            borderColor: "var(--studio-border)",
            color: "var(--text-secondary)",
            backgroundColor: "var(--studio-surface)",
          }}
          title={`Branch: ${branch}`}
        >
          {branch}
        </span>
      )}

      {/* Workspace Status pill */}
      <div
        className="flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold"
        style={{
          borderColor: "var(--studio-border)",
          color: "var(--text-secondary)",
          backgroundColor: "var(--studio-surface)",
        }}
        title={capabilities.connectionSummary}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          aria-hidden
          style={{ backgroundColor: statusColor, boxShadow: `0 0 4px ${statusColor}` }}
        />
        <span className="hidden sm:inline">{statusLabel}</span>
        <ChevronDown size={10} style={{ color: "var(--text-muted)" }} />
      </div>

      <div className="flex-1" />

      {/* Model label */}
      <span
        className="hidden sm:inline shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-bold"
        style={{
          borderColor: "var(--studio-border)",
          color: "var(--text-secondary)",
          backgroundColor: "var(--studio-surface)",
        }}
      >
        {selectedModel.label}
      </span>

      {/* Preview */}
      <button
        type="button"
        disabled={!projectReady}
        onClick={onPreview}
        className="flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold transition-all hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          borderColor: "var(--studio-border)",
          color: "var(--text-secondary)",
          backgroundColor: "var(--studio-surface)",
        }}
        title={projectReady ? "Preview" : "Connect a project to preview"}
        aria-label="Preview"
      >
        <Eye size={11} className="pointer-events-none" />
        <span className="hidden sm:inline pointer-events-none">Preview</span>
      </button>

      {/* Activity */}
      <button
        type="button"
        onClick={onOpenActivity}
        className="flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold transition-all hover:bg-white/5"
        style={{
          borderColor: "var(--studio-border)",
          color: "var(--text-secondary)",
          backgroundColor: "var(--studio-surface)",
        }}
        title="Activity"
        aria-label="Activity"
      >
        <span className="hidden sm:inline pointer-events-none">Activity</span>
      </button>

      {/* Deploy — disabled, same as real header */}
      <button
        type="button"
        disabled
        className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-black transition-all disabled:cursor-not-allowed"
        style={{
          backgroundColor: "var(--studio-card)",
          color: "var(--text-muted)",
        }}
        title="Deploy unavailable — not wired in this phase"
        aria-label="Deploy unavailable"
      >
        <Rocket size={11} className="pointer-events-none" />
        <span className="hidden sm:inline pointer-events-none">Deploy</span>
      </button>

      {/* Settings */}
      <div
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md transition-all hover:bg-white/10"
        style={{ color: "var(--text-muted)" }}
        aria-label="Settings"
        title="Settings"
      >
        <span className="text-[14px] leading-none">⋯</span>
      </div>

      {/* Mock user avatar — replaces Clerk UserButton */}
      <div
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full"
        style={{
          background: "linear-gradient(135deg, var(--litt-primary), var(--spark-primary))",
          color: "#000",
          fontSize: 10,
          fontWeight: 800,
        }}
        aria-label="Visual Tester"
        title="Visual Tester"
      >
        VT
      </div>
    </header>
  );
}
