"use client";

/**
 * /create — the canonical creation hub.
 *
 * Intent-based entry: the user describes what they want or picks a
 * starting point, and LiTT decides the internal workspace/tool path.
 * Every card deep-links into a REAL Studio surface (tool/mode pairs that
 * mapLegacyToolToDestination resolves) — no placeholder tiles, no dead
 * CTAs. The describe box carries the text straight into the LiTT
 * conversation via ?prompt= (read by useCanonicalConversation).
 */

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Globe,
  Image as ImageIcon,
  Video,
  Music,
  Code2,
  Palette,
  Gamepad2,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import PageShell from "@/components/PageShell";
import { useTheme } from "@/context/ThemeContext";

type IntentCard = {
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
};

const INTENTS: IntentCard[] = [
  {
    label: "Website",
    description: "Landing pages, sites, and web apps — built, previewed, and deployed.",
    href: "/studio?tool=chat&mode=website",
    icon: Globe,
  },
  {
    label: "Image",
    description: "Generate and edit images, then drop them into a project.",
    href: "/studio?tool=chat&mode=image",
    icon: ImageIcon,
  },
  {
    label: "Video",
    description: "Clips and motion content generated into your asset library.",
    href: "/studio?tool=chat&mode=video",
    icon: Video,
  },
  {
    label: "Music & Audio",
    description: "Songs, loops, and sound — saved as reusable assets.",
    href: "/studio?tool=chat&mode=music",
    icon: Music,
  },
  {
    label: "Code",
    description: "Start from the code workspace with LiTT alongside.",
    href: "/studio?tool=chat&mode=code",
    icon: Code2,
  },
  {
    label: "Design",
    description: "Freeform design canvas for layouts and visuals.",
    href: "/studio?tool=design",
    icon: Palette,
  },
  {
    label: "Game",
    description: "Describe a game — LiTT builds it as a playable web project.",
    href: "/studio?tool=game",
    icon: Gamepad2,
  },
];

export default function CreatePage() {
  const { resolvedColors: T } = useTheme();
  const router = useRouter();
  const [prompt, setPrompt] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = prompt.trim();
    if (!text) return;
    router.push(`/studio?tool=chat&prompt=${encodeURIComponent(text)}`);
  };

  return (
    <PageShell
      title="Create"
      subtitle="Describe what you want to make — or pick a starting point. LiTT handles the workspace."
      icon={<Globe size={22} />}
    >
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        {/* Describe — free-text intent straight into LiTT chat */}
        <form onSubmit={submit} className="mb-10">
          <label
            htmlFor="create-prompt"
            className="mb-2 block text-[10px] font-black uppercase tracking-[0.2em]"
            style={{ color: T.textMuted }}
          >
            What do you want to make?
          </label>
          <div
            className="flex items-center gap-2 rounded-2xl border p-2"
            style={{
              borderColor: `${T.borderColor}40`,
              background: `${T.boxBg}80`,
            }}
          >
            <input
              id="create-prompt"
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Build a landing page for my coffee roastery…"
              className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none"
              style={{ color: T.textColor }}
            />
            <button
              type="submit"
              disabled={!prompt.trim()}
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-4 text-xs font-black uppercase tracking-wider transition disabled:opacity-40"
              style={{ background: T.accentColor, color: T.bgColor }}
            >
              Create
              <ArrowRight size={14} />
            </button>
          </div>
        </form>

        {/* Intent cards — every tile is a real, working surface */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {INTENTS.map((intent) => {
            const Icon = intent.icon;
            return (
              <Link
                key={intent.label}
                href={intent.href}
                className="group flex items-start gap-3 rounded-2xl border p-4 transition hover:bg-white/5"
                style={{
                  borderColor: `${T.borderColor}30`,
                  background: `${T.boxBg}50`,
                }}
              >
                <span
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border"
                  style={{
                    color: T.accentColor,
                    borderColor: `${T.accentColor}40`,
                    background: `${T.accentColor}12`,
                  }}
                >
                  <Icon size={18} />
                </span>
                <span className="min-w-0">
                  <span
                    className="block text-sm font-bold"
                    style={{ color: T.textColor }}
                  >
                    {intent.label}
                  </span>
                  <span
                    className="mt-0.5 block text-xs leading-5"
                    style={{ color: T.textMuted }}
                  >
                    {intent.description}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </PageShell>
  );
}
