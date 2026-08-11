"use client";

/**
 * EmptyCanvasGreeter — "What should I build?" empty state.
 *
 * When the canvas has no content (only the empty root), this shows
 * a welcoming prompt with starter categories and quick-build options.
 * Instead of staring at an empty canvas, users are guided immediately.
 */

import { useState } from "react";
import {
  Sparkles,
  Globe,
  LayoutDashboard,
  ShoppingBag,
  Palette,
  Bot,
  Smartphone,
  Zap,
  DollarSign,
  Music,
  TrendingUp,
  Wand2,
  ArrowRight,
} from "lucide-react";
import { useCanvasBuilderStore } from "./store";
import { STARTER_BUILDS, buildStarterPage } from "./starter-builds";

const CATEGORIES = [
  { id: "Website", label: "Website", icon: Globe, desc: "Landing pages, business sites" },
  { id: "App UI", label: "App UI", icon: Smartphone, desc: "Settings, login, onboarding" },
  { id: "Store", label: "Store", icon: ShoppingBag, desc: "Product pages, storefronts" },
  { id: "SaaS", label: "Dashboard", icon: LayoutDashboard, desc: "Analytics, admin, CRM" },
  { id: "Creator", label: "Portfolio", icon: Palette, desc: "Gallery, media kit, link-in-bio" },
  { id: "AI", label: "AI Tool", icon: Bot, desc: "Chatbot, generator, agent UI" },
];

const QUICK_BUILDS = [
  { label: "Build something for my business", icon: TrendingUp, buildId: "business-site" },
  { label: "Build something I can sell", icon: DollarSign, buildId: "store" },
  { label: "Build something for my music", icon: Music, buildId: "landing-page" },
  { label: "Build a store", icon: ShoppingBag, buildId: "store" },
  { label: "Build a dashboard", icon: LayoutDashboard, buildId: "saas-dashboard" },
  { label: "Build an AI interface", icon: Bot, buildId: "ai-tool" },
  { label: "Surprise me", icon: Wand2, buildId: "landing-page" },
];

export function EmptyCanvasGreeter() {
  const [step, setStep] = useState<"greeting" | "describe">("greeting");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const setDocument = useCanvasBuilderStore((s) => s.setDocument);
  const setRightPanelTab = useCanvasBuilderStore((s) => s.setRightPanelTab);

  const isEmpty = useCanvasBuilderStore((s) => {
    const root = s.document.nodes[s.document.rootNodeIds[0]];
    return !root || root.children.length === 0;
  });

  if (!isEmpty) return null;

  const handleQuickBuild = (buildId: string) => {
    const build = STARTER_BUILDS.find((b) => b.id === buildId);
    if (build) {
      setDocument(buildStarterPage(build));
      setRightPanelTab("litt");
    }
  };

  const handleCategorySelect = (categoryId: string) => {
    setSelectedCategory(categoryId);
    setStep("describe");
  };

  const categoryBuilds = selectedCategory
    ? STARTER_BUILDS.filter((b) => b.category === selectedCategory)
    : [];

  if (step === "greeting") {
    return (
      <div className="absolute inset-0 flex items-center justify-center" style={{ zIndex: 10 }}>
        <div
          className="flex flex-col items-center gap-6 rounded-2xl border p-8 max-w-md"
          style={{
            borderColor: "var(--glass-border)",
            backgroundColor: "rgba(10,11,16,0.9)",
            backdropFilter: "blur(12px)",
          }}
        >
          {/* Logo / greeting */}
          <div className="flex flex-col items-center gap-2">
            <div
              className="flex items-center justify-center rounded-2xl"
              style={{
                width: 48,
                height: 48,
                backgroundColor: "var(--glass-purple-soft)",
                border: "1px solid var(--glass-border-purple)",
              }}
            >
              <Sparkles size={24} style={{ color: "var(--glass-purple)" }} />
            </div>
            <h2 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
              What are we building?
            </h2>
            <p className="text-sm text-center" style={{ color: "var(--text-muted)" }}>
              Choose a category and LiTT will help you build it.
            </p>
          </div>

          {/* Category grid */}
          <div className="grid grid-cols-3 gap-2 w-full">
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              return (
                <button
                  key={cat.id}
                  onClick={() => handleCategorySelect(cat.id)}
                  className="flex flex-col items-center gap-1.5 rounded-xl border p-3 transition hover:-translate-y-0.5"
                  style={{
                    borderColor: "var(--glass-border)",
                    backgroundColor: "rgba(255,255,255,0.02)",
                  }}
                >
                  <Icon size={20} style={{ color: "var(--glass-purple)" }} />
                  <span className="text-[11px] font-bold" style={{ color: "var(--glass-text-2)" }}>
                    {cat.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 w-full">
            <div style={{ flex: 1, height: 1, backgroundColor: "var(--glass-border)" }} />
            <span className="text-[10px] font-bold uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>
              or
            </span>
            <div style={{ flex: 1, height: 1, backgroundColor: "var(--glass-border)" }} />
          </div>

          {/* Quick builds */}
          <div className="flex flex-col gap-1.5 w-full">
            {QUICK_BUILDS.slice(0, 4).map((qb) => {
              const Icon = qb.icon;
              return (
                <button
                  key={qb.label}
                  onClick={() => handleQuickBuild(qb.buildId)}
                  className="flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition hover:bg-white/5"
                  style={{
                    borderColor: "var(--glass-border)",
                    backgroundColor: "rgba(255,255,255,0.02)",
                  }}
                >
                  <Icon size={14} style={{ color: "var(--glass-purple)" }} />
                  <span className="text-[12px] font-medium" style={{ color: "var(--glass-text-2)" }}>
                    {qb.label}
                  </span>
                  <ArrowRight size={12} style={{ color: "var(--text-muted)", marginLeft: "auto" }} />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Step 2: Describe / pick template
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ zIndex: 10 }}>
      <div
        className="flex flex-col items-center gap-4 rounded-2xl border p-6 max-w-lg"
        style={{
          borderColor: "var(--glass-border)",
          backgroundColor: "rgba(10,11,16,0.9)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div className="flex items-center gap-2 w-full">
          <button
            onClick={() => setStep("greeting")}
            className="text-[11px] font-bold transition hover:opacity-70"
            style={{ color: "var(--text-muted)" }}
          >
            ← Back
          </button>
          <h2 className="text-lg font-bold flex-1 text-center" style={{ color: "var(--text-primary)" }}>
            {selectedCategory} Templates
          </h2>
        </div>

        <div className="flex flex-col gap-2 w-full">
          {categoryBuilds.map((build) => (
            <button
              key={build.id}
              onClick={() => handleQuickBuild(build.id)}
              className="flex items-center gap-3 rounded-xl border p-4 text-left transition hover:bg-white/5"
              style={{
                borderColor: "var(--glass-border)",
                backgroundColor: "rgba(255,255,255,0.02)",
              }}
            >
              <div
                className="flex items-center justify-center rounded-lg"
                style={{ width: 36, height: 36, backgroundColor: "var(--glass-purple-soft)" }}
              >
                <Sparkles size={16} style={{ color: "var(--glass-purple)" }} />
              </div>
              <div className="flex flex-col gap-0.5 flex-1">
                <span className="text-[13px] font-bold" style={{ color: "var(--glass-text-1)" }}>
                  {build.label}
                </span>
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {build.description}
                </span>
              </div>
              <ArrowRight size={14} style={{ color: "var(--text-muted)" }} />
            </button>
          ))}
        </div>

        <button
          onClick={() => {
            setStep("greeting");
            setRightPanelTab("litt");
          }}
          className="flex items-center gap-1.5 text-[11px] font-bold transition hover:opacity-70"
          style={{ color: "var(--glass-purple)" }}
        >
          <Zap size={12} />
          Describe it instead →
        </button>
      </div>
    </div>
  );
}
