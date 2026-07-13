"use client";

import { useEffect, useState } from "react";
import { useTheme } from "@/context/ThemeContext";

type LoopState = "checking" | "ok" | "degraded" | "down";

type CheckResult = {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
};

const CHECK_ENDPOINTS: Array<{ id: string; label: string; url: string }> = [
  { id: "director", label: "Director planner", url: "/api/director/plan" },
  { id: "agents", label: "Agent roster", url: "/api/agents" },
  { id: "memory", label: "Memory store", url: "/api/memory" },
  { id: "agent-tasks", label: "Task intake", url: "/api/agent-tasks" },
];

/* ---------- Inline SVG icons (no external icon dependency) ---------- */

type IconProps = {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
};

function IconWrap({
  size = 14,
  className,
  style,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function ActivityIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </IconWrap>
  );
}

function CheckIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="9 12 12 15 16 10" />
    </IconWrap>
  );
}

function AlertIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </IconWrap>
  );
}

function SpinnerIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
      <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
      <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
    </IconWrap>
  );
}

function CloseIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </IconWrap>
  );
}

/* ---------- Component ---------- */

/**
 * AutonomicLoopBanner
 *
 * A non-intrusive sticky banner that pings the core orchestration
 * endpoints and surfaces whether the Director → Agent-Tasks → Worker
 * pipeline is healthy. This directly satisfies the "Verify the
 * Autonomic Loop setup" portion of the active Director task.
 *
 * - Polls once on mount and every 60 s.
 * - Collapsible; defaults to a single-line status pill.
 * - Reads the active volcanic cyber theme tokens for visual cohesion.
 * - Uses inline SVG icons to avoid a lucide-react type resolution
 *   dependency.
 */
export default function AutonomicLoopBanner() {
  const { tokens } = useTheme();
  const [state, setState] = useState<LoopState>("checking");
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
          />
          <span
            className="uppercase tracking-[0.18em]"
            style={{ color: palette.color }}
          >
            {palette.label}
          </span>
          <span
            className="opacity-50 hidden sm:inline"
            style={{ color: tokens.textMuted }}
          >
            {lastChecked
              ? `· checked ${lastChecked.toLocaleTimeString()}`
              : "· probing..."}
          </span>
          <span className="ml-auto flex items-center gap-2">
            <Activity
              size={12}
              style={{ color: tokens.textMuted, opacity: expanded ? 1 : 0.4 }}
            />
            <span
              className="hidden sm:inline"
              style={{ color: tokens.textMuted, opacity: 0.6 }}
            >
              {expanded ? "hide details" : "show details"}
            </span>
          </span>
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="ml-2 opacity-50 hover:opacity-100 transition-opacity"
          aria-label="Dismiss banner"
        >
          <X size={12} style={{ color: tokens.textMuted }} />
        </button>
      </div>

      {expanded && (
        <div
          className="px-4 pb-3 pt-1 grid grid-cols-2 sm:grid-cols-4 gap-2"
          style={{ borderTop: `1px solid ${tokens.border}30` }}
        >
          {checks.length === 0
            ? CHECK_ENDPOINTS.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center gap-2 text-[10px] font-mono"
                  style={{ color: tokens.textMuted }}
                >
                  <Loader2 size={10} className="animate-spin" />
                  {e.label}…
                </div>
              ))
            : checks.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 text-[10px] font-mono"
                  style={{ color: tokens.text }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: c.ok ? "#22c55e" : "#ef4444" }}
                  />
                  <span className="truncate">{c.label}</span>
                  <span style={{ color: tokens.textMuted, opacity: 0.6 }}>
                    {c.detail}
                  </span>
                </div>
              ))}
        </div>
      )}
    </div>
  );
}
