"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { Plus, X, Image as ImageIcon, Music, Video, Bot, Workflow, Globe, Terminal } from "lucide-react";

const CREATE_OPTIONS = [
  { label: "Build App", icon: Workflow, href: "/studio?tool=chat", color: "#22d3ee" },
  { label: "Ask LiTTree", icon: Bot, href: "/studio?tool=chat", color: "#a3f546" },
  { label: "Generate Image", icon: ImageIcon, href: "/studio?tool=image", color: "#e879f9" },
  { label: "Music", icon: Music, href: "/studio?tool=audio", color: "#fb923c" },
  { label: "Website", icon: Globe, href: "/studio?tool=chat", color: "#f472b6" },
  { label: "Run Command", icon: Terminal, href: "/studio?tool=chat", color: "#4ade80" },
  { label: "Create Video", icon: Video, href: "/studio?tool=video", color: "#38bdf8" },
];

const HIDE_ON = ["/studio", "/admin"];

export default function CreateFAB() {
  const router = useRouter();
  const pathname = usePathname();
  const { resolvedColors: T } = useTheme();
  const [open, setOpen] = useState(false);

  if (HIDE_ON.some((p) => pathname?.startsWith(p))) return null;

  return (
    <>
      {/* FAB Button */}
      <button
        onClick={() => setOpen(!open)}
        className="md:hidden fixed bottom-20 right-4 z-40 flex items-center justify-center w-14 h-14 rounded-full shadow-lg transition-all active:scale-95"
        style={{
          backgroundColor: T.accentColor,
          color: T.bgColor,
          boxShadow: `0 0 20px ${T.accentColor}60`,
        }}
      >
        {open ? <X size={24} /> : <Plus size={24} />}
      </button>

      {/* Menu Overlay */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Menu */}
      {open && (
        <div className="md:hidden fixed bottom-36 right-4 z-40 w-60 rounded-xl border shadow-2xl overflow-hidden"
          style={{
            backgroundColor: T.boxBg,
            borderColor: T.borderColor + "30",
          }}
        >
          <div className="p-2 space-y-1">
            {CREATE_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.label}
                  onClick={() => {
                    router.push(option.href);
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-bold transition-all hover:scale-[1.02]"
                  style={{
                    backgroundColor: `${option.color}10`,
                    color: option.color,
                  }}
                >
                  <Icon size={16} />
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
