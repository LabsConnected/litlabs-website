"use client";

import { Terminal, FileCode, Logs, Command, Bot, Rocket, Wifi, Cpu, Activity } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

const services = [
  { icon: Terminal, label: "Terminal", status: "Online" },
  { icon: FileCode, label: "File System", status: "Online" },
  { icon: Logs, label: "Logs", status: "Online" },
  { icon: Command, label: "Command History", status: "Online" },
  { icon: Bot, label: "Agents", status: "Online" },
  { icon: Rocket, label: "Deployments", status: "Online" },
];

export function LittCodeSystemStatus() {
  const { resolvedColors: T } = useTheme();
  return (
    <div
      className="rounded-2xl border p-5"
      style={{ backgroundColor: T.boxBg, borderColor: T.borderColor + "20" }}
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4" style={{ color: T.accentColor }} />
          <h3 className="text-sm font-black uppercase tracking-wider" style={{ color: T.headerColor }}>
            System Status
          </h3>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-green-500/10 px-2 py-1 text-xs font-bold text-green-400">
          <Wifi className="h-3 w-3" /> All Online
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {services.map((svc) => {
          const Icon = svc.icon;
          return (
            <div
              key={svc.label}
              className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs"
              style={{ borderColor: T.borderColor + "20", color: T.textMuted }}
            >
              <Icon className="h-3.5 w-3.5" style={{ color: T.accentColor }} />
              <span className="font-bold">{svc.label}</span>
              <span className="ml-auto text-[10px] text-green-400">{svc.status}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-3 rounded-xl border p-3 text-xs" style={{ borderColor: T.borderColor + "20" }}>
        <Cpu className="h-4 w-4" style={{ color: T.accentColor }} />
        <div className="flex-1">
          <div className="font-bold" style={{ color: T.textColor }}>Processing Hub</div>
          <div style={{ color: T.textMuted }}>Connected to LiTTree OS across all routes</div>
        </div>
        <span className="rounded-full bg-green-500/10 px-2 py-1 font-bold text-green-400">Active</span>
      </div>
    </div>
  );
}
