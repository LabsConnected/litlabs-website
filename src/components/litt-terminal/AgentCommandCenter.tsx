"use client";

import {
  Terminal,
  Cpu,
  Image,
  Search,
  Brain,
  Rocket,
  Folder,
  Gamepad2,
  Music,
  ShoppingBag,
  History,
  Radio,
  Wrench,
} from "lucide-react";

export type CommandItem = {
  id: string;
  label: string;
  icon: React.ElementType;
  status?: "live" | "building" | "published" | "pending" | "idle";
  badge?: string | number;
};

const COMMANDS: CommandItem[] = [
  { id: "mission", label: "Current Mission", icon: Terminal, status: "live" },
  { id: "project", label: "Active Project", icon: Folder, status: "building" },
  { id: "memory", label: "Memory", icon: Brain, status: "idle" },
  { id: "files", label: "Files", icon: Folder, status: "idle" },
  {
    id: "artifacts",
    label: "Artifacts",
    icon: Rocket,
    status: "building",
    badge: 2,
  },
  { id: "terminal", label: "Terminal", icon: Terminal, status: "live" },
  { id: "browser", label: "Browser", icon: Search, status: "idle" },
  { id: "deploy", label: "Deploy", icon: Rocket, status: "pending" },
  {
    id: "marketplace",
    label: "Marketplace",
    icon: ShoppingBag,
    status: "published",
  },
  { id: "gallery", label: "Gallery", icon: Image, status: "idle" },
  { id: "console", label: "Console", icon: Cpu, status: "idle" },
  { id: "games", label: "Games", icon: Gamepad2, status: "idle" },
  { id: "music", label: "Music", icon: Music, status: "idle" },
  { id: "radio", label: "Radio", icon: Radio, status: "idle" },
  { id: "automation", label: "Automation", icon: Wrench, status: "idle" },
  { id: "history", label: "History", icon: History, status: "idle" },
];

const STATUS_DOT: Record<string, string> = {
  live: "bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]",
  building: "bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.8)] animate-pulse",
  published: "bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.8)]",
  pending: "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]",
  idle: "bg-neutral-600",
};

export function AgentCommandCenter({
  activeId,
  onSelect,
  onDeploy,
}: {
  activeId: string;
  onSelect: (id: string) => void;
  onDeploy?: () => void;
}) {
  return (
    <div className="flex h-full flex-col gap-4 border-r border-neutral-800/60 bg-[#060606] p-3">
      <div className="flex items-center gap-2 px-2 py-1">
        <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-cyan-500/20 to-fuchsia-500/20 border border-cyan-500/30">
          <Terminal size={16} className="text-cyan-300" />
          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.9)]" />
        </div>
        <div>
          <div className="text-xs font-black tracking-wider text-cyan-300">
            LiTT CODE
          </div>
          <div className="text-[9px] font-bold text-neutral-500 uppercase tracking-widest">
            Mission Control
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto pr-1">
        {COMMANDS.map((cmd) => {
          const Icon = cmd.icon;
          const isActive = activeId === cmd.id;
          return (
            <button
              key={cmd.id}
              onClick={() => {
                if (cmd.id === "deploy" && onDeploy) {
                  onDeploy();
                }
                onSelect(cmd.id);
              }}
              className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all ${
                isActive
                  ? "bg-cyan-500/10 border border-cyan-500/30 shadow-[0_0_12px_rgba(34,211,238,0.12)]"
                  : "hover:bg-white/5 border border-transparent"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[cmd.status || "idle"]} ${isActive ? "scale-110" : ""}`}
              />
              <Icon
                size={15}
                className={
                  isActive
                    ? "text-cyan-300"
                    : "text-neutral-400 group-hover:text-neutral-200"
                }
              />
              <span
                className={`flex-1 text-xs font-semibold ${isActive ? "text-cyan-100" : "text-neutral-300 group-hover:text-neutral-100"}`}
              >
                {cmd.label}
              </span>
              {cmd.badge ? (
                <span className="rounded-md bg-orange-500/20 px-1.5 py-0.5 text-[9px] font-black text-orange-300">
                  {cmd.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-neutral-800/60 bg-neutral-900/40 p-3">
        <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-neutral-500">
          Active Agents
        </div>
        <div className="space-y-2">
          <AgentRow
            name="Director"
            role="Planning"
            color="cyan"
            progress={82}
          />
          <AgentRow name="Forge" role="Coding" color="orange" progress={64} />
          <AgentRow
            name="Visionary"
            role="Design"
            color="fuchsia"
            progress={0}
          />
          <AgentRow
            name="Research"
            role="Searching"
            color="blue"
            progress={0}
          />
        </div>
      </div>
    </div>
  );
}

function AgentRow({
  name,
  role,
  color,
  progress,
}: {
  name: string;
  role: string;
  color: string;
  progress: number;
}) {
  const colorMap: Record<string, string> = {
    cyan: "bg-cyan-400",
    orange: "bg-orange-400",
    fuchsia: "bg-fuchsia-400",
    blue: "bg-blue-400",
  };
  return (
    <div className="flex items-center gap-2">
      <div
        className={`h-1.5 w-1.5 rounded-full ${colorMap[color]} ${progress > 0 ? "animate-pulse" : ""}`}
      />
      <div className="flex-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-neutral-200">{name}</span>
          <span className="text-[9px] text-neutral-500">{role}</span>
        </div>
        {progress > 0 ? (
          <div className="mt-1 h-1 w-full rounded-full bg-neutral-800">
            <div
              className={`h-1 rounded-full ${colorMap[color]}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
