"use client";

import Link from "next/link";
import { Bot, ImageIcon, Music, Terminal, Wallet, MessageSquare, ArrowRight } from "lucide-react";
import { BentoCard } from "@/components/site/BentoCard";
import { LC } from "../lit-console-theme";

const QUICK_LINKS = [
  { href: "/studio?tool=chat", label: "LiTT CODE", icon: Bot, desc: "Build, code, route, and ask" },
  { href: "/studio?tool=image", label: "Imaging Lab", icon: ImageIcon, desc: "Generate images & art" },
  { href: "/studio?tool=audio", label: "Music Studio", icon: Music, desc: "Create AI music" },
  { href: "/studio?tool=chat", label: "Terminal", icon: Terminal, desc: "Agent dev console" },
  { href: "/marketplace", label: "Marketplace", icon: Wallet, desc: "Buy & sell agents" },
  { href: "/social", label: "Neural Social", icon: MessageSquare, desc: "Community feed" },
];

export function QuickAccessWidget() {
  return (
    <BentoCard title="Quick Access" icon={<Terminal size={14} />}>
      <div className="space-y-1">
        {QUICK_LINKS.map((a) => {
          const Icon = a.icon;
          return (
            <Link
              key={a.href}
              href={a.href}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-all hover:scale-[1.01] group"
              style={{ backgroundColor: `${LC.bgSecondary}80` }}
            >
              <div
                className="w-6 h-6 rounded flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${LC.accentCyan}12` }}
              >
                <Icon size={11} style={{ color: LC.accentCyan }} />
              </div>
              <div className="flex-1 min-w-0">
                <div
                  className="text-[11px] font-bold leading-none"
                  style={{ color: LC.text }}
                >
                  {a.label}
                </div>
                <div className="text-[10px] opacity-40 truncate mt-0.5">
                  {a.desc}
                </div>
              </div>
              <ArrowRight
                size={10}
                className="opacity-0 group-hover:opacity-40 transition-opacity"
                style={{ color: LC.textMuted }}
              />
            </Link>
          );
        })}
      </div>
    </BentoCard>
  );
}
