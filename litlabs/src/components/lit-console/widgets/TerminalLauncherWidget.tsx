"use client";

import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { Terminal, Play } from "lucide-react";
import { BentoCard } from "@/components/site/BentoCard";

const QUICK_COMMANDS = [
  { id: "dev", label: "npm run dev", href: "/admin/terminal" },
  { id: "build", label: "npm run build", href: "/admin/terminal" },
  { id: "lint", label: "npm run lint", href: "/admin/terminal" },
  { id: "git", label: "git status", href: "/admin/terminal" },
  { id: "deploy", label: "vercel deploy", href: "/admin/terminal" },
];

export function TerminalLauncherWidget() {
  const { resolvedColors: T } = useTheme();

  return (
    <BentoCard
      title="Terminal"
      icon={<Terminal size={14} />}
      action={
        <Link
          href="/admin/terminal"
          className="text-[10px] font-bold uppercase tracking-wider transition hover:opacity-70"
          style={{ color: T.accentColor }}
        >
          Open
        </Link>
      }
    >
      <div className="flex flex-col gap-2">
        <div
          className="flex items-center gap-2 rounded-lg border p-2"
          style={{
            borderColor: `${T.borderColor}25`,
            backgroundColor: `${T.borderColor}08`,
          }}
        >
          <span
            className="h-2 w-2 animate-pulse rounded-full"
            style={{
              backgroundColor: T.success,
              boxShadow: `0 0 8px ${T.success}`,
            }}
          />
          <span className="text-xs font-mono" style={{ color: T.textMuted }}>
            Terminal ready
          </span>
        </div>
        <div className="grid grid-cols-1 gap-1.5">
          {QUICK_COMMANDS.map((cmd) => (
            <Link
              key={cmd.id}
              href={cmd.href}
              className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs font-mono transition hover:opacity-80"
              style={{ borderColor: `${T.borderColor}25`, color: T.textColor }}
            >
              <span>{cmd.label}</span>
              <Play size={12} style={{ color: T.accentColor }} />
            </Link>
          ))}
        </div>
      </div>
    </BentoCard>
  );
}
