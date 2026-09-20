"use client";

/**
 * QuickStart — guided creation first, with six manual creation paths below.
 *
 * Website, App, Game, Image, Video, Music.
 * Launch actions only — uses existing routes/actions.
 */

import Link from "next/link";
import { Globe, Smartphone, Gamepad2, Image as ImageIcon, Film, Music } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DescribeBusinessBox } from "@/components/studio/DescribeBusinessBox";

interface QuickStartItem {
  label: string;
  icon: LucideIcon;
  href: string;
  accent: string;
}

const ITEMS: QuickStartItem[] = [
  { label: "Website", icon: Globe, href: "/studio?tool=chat&mode=website", accent: "#a78bfa" },
  { label: "App", icon: Smartphone, href: "/studio?tool=build", accent: "#34d399" },
  { label: "Game", icon: Gamepad2, href: "/studio?tool=game", accent: "#f59e0b" },
  { label: "Image", icon: ImageIcon, href: "/studio?tool=chat&mode=image", accent: "#06b6d4" },
  { label: "Video", icon: Film, href: "/studio?tool=chat&mode=video", accent: "#ec4899" },
  { label: "Music", icon: Music, href: "/studio?tool=chat&mode=music", accent: "#8b5cf6" },
];

export function QuickStart() {
  return (
    <>
      {/* Guided start: describe-once intake. Project-less here, so a
          confirmed description is stashed as a pending intake and adopted
          into the active project when the user reaches Studio. */}
      <div id="dashboard-guided-start" className="mb-6 scroll-mt-24">
        <DescribeBusinessBox variant="dashboard" />
      </div>
      <section>
      <h3 className="mb-4 pl-1 text-sm font-medium uppercase tracking-widest" style={{ color: "#71717a" }}>
        Quick Start
      </h3>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={item.href}
              className="group flex flex-col items-center justify-center gap-3 rounded-lg border p-4 transition-all"
              style={{
                background: "rgba(18,18,21,0.7)",
                borderColor: "rgba(255,255,255,0.06)",
                backdropFilter: "blur(12px)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = `${item.accent}40`;
                e.currentTarget.style.background = "rgba(24,24,27,0.8)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
                e.currentTarget.style.background = "rgba(18,18,21,0.7)";
              }}
            >
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full transition-colors"
                style={{
                  background: "rgba(30,30,34,0.8)",
                  color: "#a1a1aa",
                }}
              >
                <Icon
                  size={20}
                  className="transition-colors group-hover:text-current"
                  style={{ color: undefined }}
                />
              </div>
              <span className="text-sm font-medium" style={{ color: "#fafafa" }}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
      </section>
    </>
  );
}
