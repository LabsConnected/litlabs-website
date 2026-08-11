"use client";

/**
 * BuildPanel — the "big idea launcher" tab.
 *
 * Shows starter build categories (Website, SaaS, Store, etc.)
 * and full-page templates. Clicking one populates the entire Canvas.
 */

import { useState } from "react";
import {
  Rocket,
  Building2,
  LayoutDashboard,
  ShoppingBag,
  Palette,
  Bot,
  Smartphone,
  Globe,
  type LucideIcon,
} from "lucide-react";
import { STARTER_BUILDS, STARTER_CATEGORIES, buildStarterPage, type StarterBuild } from "./starter-builds";
import { useCanvasBuilderStore } from "./store";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Globe,
  LayoutDashboard,
  ShoppingBag,
  Palette,
  Bot,
  Smartphone,
};

const BUILD_ICONS: Record<string, LucideIcon> = {
  Rocket,
  Building2,
  LayoutDashboard,
  ShoppingBag,
  Palette,
  Bot,
};

export function BuildPanel() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const setDocument = useCanvasBuilderStore((s) => s.setDocument);

  const filteredBuilds = selectedCategory
    ? STARTER_BUILDS.filter((b) => b.category === selectedCategory)
    : STARTER_BUILDS;

  const handleBuildClick = (build: StarterBuild) => {
    const doc = buildStarterPage(build);
    setDocument(doc);
  };

  return (
    <div className="flex h-full w-full flex-col">
      {/* Categories */}
      <div className="shrink-0 p-2" style={{ borderBottom: "1px solid var(--glass-border)" }}>
        <div className="text-[9px] font-black uppercase tracking-[0.1em] mb-2" style={{ color: "var(--glass-text-3)" }}>
          Categories
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {STARTER_CATEGORIES.map((cat) => {
            const Icon = CATEGORY_ICONS[cat.icon] ?? Globe;
            const isActive = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(isActive ? null : cat.id)}
                className="flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 transition hover:-translate-y-0.5"
                style={{
                  borderColor: isActive ? "var(--glass-border-purple)" : "var(--glass-border)",
                  backgroundColor: isActive ? "var(--glass-purple-soft)" : "rgba(255,255,255,0.03)",
                }}
              >
                <Icon size={16} style={{ color: isActive ? "var(--glass-purple)" : "var(--glass-text-2)" }} />
                <span className="text-[10px] font-bold" style={{ color: isActive ? "var(--glass-purple)" : "var(--glass-text-2)" }}>
                  {cat.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Builds list */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="text-[9px] font-black uppercase tracking-[0.1em] mb-2" style={{ color: "var(--glass-text-3)" }}>
          {selectedCategory ? `${selectedCategory} Templates` : "All Templates"}
        </div>
        <div className="flex flex-col gap-1.5">
          {filteredBuilds.map((build) => {
            const Icon = BUILD_ICONS[build.icon] ?? Rocket;
            return (
              <button
                key={build.id}
                onClick={() => handleBuildClick(build)}
                className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition hover:bg-white/5"
                style={{ borderColor: "var(--glass-border)", backgroundColor: "rgba(255,255,255,0.02)" }}
              >
                <Icon size={16} style={{ color: "var(--glass-purple)", marginTop: 2, flexShrink: 0 }} />
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[11px] font-bold" style={{ color: "var(--glass-text-1)" }}>
                    {build.label}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {build.description}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
