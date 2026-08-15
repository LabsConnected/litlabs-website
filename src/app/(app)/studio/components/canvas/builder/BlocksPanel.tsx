"use client";

/**
 * BlocksPanel — pre-built section blocks library.
 *
 * Shows categorized section blocks (Navigation, Hero, Content, etc.)
 * that users can click to add to the canvas, or drag onto a specific
 * position.
 */

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  type LucideIcon,
  Menu,
  PanelBottom,
  Megaphone,
  Sparkles,
  Columns2,
  Video,
  Grid3x3,
  LayoutGrid,
  BarChart3,
  Building2,
  Quote,
  Tag,
  Mail,
  HelpCircle,
  Users,
  Images,
  LayoutDashboard,
  Table,
  LogIn,
  UserPlus,
  ShoppingBag,
} from "lucide-react";
import { BLOCK_CATEGORIES } from "./section-blocks";
import { useCanvasBuilderStore } from "./store";
import type { SectionTemplate } from "./types";

const BLOCK_ICONS: Record<string, LucideIcon> = {
  Menu,
  "PanelBottom": PanelBottom,
  Megaphone,
  Sparkles,
  "Columns2": Columns2,
  Video,
  "Grid3x3": Grid3x3,
  "LayoutGrid": LayoutGrid,
  "BarChart3": BarChart3,
  "Building2": Building2,
  Quote,
  Tag,
  Mail,
  "HelpCircle": HelpCircle,
  Users,
  "Images": Images,
  "LayoutDashboard": LayoutDashboard,
  Table,
  "LogIn": LogIn,
  "UserPlus": UserPlus,
  "ShoppingBag": ShoppingBag,
};

export function BlocksPanel() {
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set(["hero"]));
  const addSectionTemplate = useCanvasBuilderStore((s) => s.addSectionTemplate);
  const document = useCanvasBuilderStore((s) => s.document);

  const toggleCat = (catId: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  const handleAddBlock = (template: SectionTemplate) => {
    const rootId = document.rootNodeIds[0];
    if (rootId) {
      addSectionTemplate(template, rootId);
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto p-2">
      {BLOCK_CATEGORIES.map((cat) => {
        const isExpanded = expandedCats.has(cat.id);
        return (
          <div key={cat.id} className="mb-1">
            <button
              onClick={() => toggleCat(cat.id)}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] font-black uppercase tracking-[0.08em] transition hover:bg-white/5"
              style={{ color: "var(--glass-text-2)" }}
            >
              {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              {cat.label}
              <span style={{ color: "var(--text-muted)", fontWeight: 600, marginLeft: "auto" }}>
                {cat.blocks.length}
              </span>
            </button>

            {isExpanded && (
              <div className="flex flex-col gap-1 pl-3 pt-1">
                {cat.blocks.map((block) => {
                  const Icon = BLOCK_ICONS[block.icon] ?? Sparkles;
                  return (
                    <button
                      key={block.id}
                      onClick={() => handleAddBlock(block)}
                      className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-left transition hover:bg-white/5"
                      style={{
                        borderColor: "var(--glass-border)",
                        backgroundColor: "rgba(255,255,255,0.02)",
                      }}
                      title={`Add ${block.label} section`}
                    >
                      <Icon size={14} style={{ color: "var(--glass-purple)", flexShrink: 0 }} />
                      <span className="text-[10px] font-bold" style={{ color: "var(--glass-text-2)" }}>
                        {block.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
