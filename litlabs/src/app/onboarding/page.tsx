import type { Metadata } from "next";
import Link from "next/link";
import { Wand2, Bot, ShoppingBag, ArrowRight, Sparkles } from "lucide-react";

export const metadata: Metadata = {
  title: "Welcome to LiTTree OS",
  description: "Choose your first action in LiTTree OS.",
};

const BG = "#08080c";
const PANEL = "#101018";
const BORDER = "#252538";
const CYAN = "#00f5ff";
const TEXT = "#f8fafc";
const MUTED = "#94a3b8";

const ACTIONS = [
  {
    id: "studio",
    label: "Build in Studio",
    desc: "Create your first agent workflow in the visual builder.",
    icon: Wand2,
    color: CYAN,
    href: "/studio",
  },
  {
    id: "agents",
    label: "Browse Agents",
    desc: "Pick a specialist agent and start using it right away.",
    icon: Bot,
    color: "#22c55e",
    href: "/agents",
  },
  {
    id: "marketplace",
    label: "Explore Marketplace",
    desc: "Discover premium agents, workflows, and templates.",
    icon: ShoppingBag,
    color: "#f59e0b",
    href: "/marketplace",
  },
];

export default function OnboardingPage() {
  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center px-4 py-12"
      style={{ backgroundColor: BG, color: TEXT }}
    >
      <div className="text-center max-w-2xl mb-10">
        <div
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold mb-6 border"
          style={{ borderColor: "#00f5ff30", backgroundColor: "#00f5ff08" }}
        >
          <Sparkles className="h-3.5 w-3.5" style={{ color: CYAN }} />
          500 starter credits activated
        </div>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight mb-3">
          What do you want to build first?
        </h1>
        <p className="text-base" style={{ color: MUTED }}>
          Pick one starting point. You can access everything from the dashboard
          later.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-4xl">
        {ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.id}
              href={action.href}
              className="group relative flex flex-col rounded-2xl border p-6 transition-all hover:-translate-y-1"
              style={{
                backgroundColor: PANEL,
                borderColor: BORDER,
              }}
            >
              <div
                className="absolute inset-0 rounded-2xl opacity-0 transition-opacity group-hover:opacity-100"
                style={{
                  background: `radial-gradient(circle at top right, ${action.color}10, transparent 60%)`,
                }}
              />
              <div className="relative">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
                  style={{ backgroundColor: `${action.color}15` }}
                >
                  <Icon className="h-6 w-6" style={{ color: action.color }} />
                </div>
                <div className="text-lg font-bold mb-1">{action.label}</div>
                <p className="text-sm mb-4" style={{ color: MUTED }}>
                  {action.desc}
                </p>
                <div
                  className="mt-auto inline-flex items-center gap-1 text-xs font-bold transition-colors"
                  style={{ color: action.color }}
                >
                  Start here <ArrowRight className="h-3.5 w-3.5" />
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <Link
        href="/studio?tool=chat"
        className="mt-8 inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold border transition-all hover:bg-white/5"
        style={{ borderColor: BORDER, color: MUTED }}
      >
        Skip to LiT Console
      </Link>
    </main>
  );
}
