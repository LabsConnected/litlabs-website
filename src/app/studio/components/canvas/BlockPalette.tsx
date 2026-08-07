"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { BlockType, WebsiteBlockType } from "@/lib/canvas/types";

// ─── Block palette definitions ──────────────────────────────────

interface PaletteBlock {
  type: WebsiteBlockType;
  label: string;
  icon: string;
  description: string;
  category: "layout" | "content" | "conversion";
  defaults: Record<string, unknown>;
}

const PALETTE_BLOCKS: PaletteBlock[] = [
  {
    type: "navbar",
    label: "Navbar",
    icon: "🧭",
    description: "Navigation bar with brand and links",
    category: "layout",
    defaults: {
      brand: "Brand",
      links: [
        { label: "Features", href: "#features" },
        { label: "Pricing", href: "#pricing" },
        { label: "About", href: "#about" },
      ],
      ctaLabel: "Get Started",
      ctaHref: "#",
    },
  },
  {
    type: "hero",
    label: "Hero",
    icon: "🚀",
    description: "Hero section with headline and CTAs",
    category: "layout",
    defaults: {
      badge: "New",
      title: "Build something amazing",
      subtitle: "The fastest way to launch your next project.",
      primaryLabel: "Get Started",
      primaryHref: "#",
      secondaryLabel: "Learn More",
      secondaryHref: "#",
      bgGradient: true,
    },
  },
  {
    type: "features",
    label: "Features",
    icon: "✨",
    description: "Feature grid with icons and descriptions",
    category: "content",
    defaults: {
      title: "Features",
      subtitle: "Everything you need, nothing you don't.",
      columns: 3,
      items: [
        { id: "f1", icon: "⚡", title: "Fast", description: "Lightning quick performance." },
        { id: "f2", icon: "🔒", title: "Secure", description: "Enterprise-grade security." },
        { id: "f3", icon: "🎨", title: "Beautiful", description: "Stunning design out of the box." },
      ],
    },
  },
  {
    type: "pricing",
    label: "Pricing",
    icon: "💎",
    description: "Pricing tiers with feature lists",
    category: "conversion",
    defaults: {
      title: "Pricing",
      subtitle: "Simple, transparent pricing.",
      tiers: [
        { id: "t1", name: "Starter", price: "$0", period: "/mo", description: "For getting started.", features: ["1 project", "Community support", "Basic features"], highlighted: false, ctaLabel: "Start Free", ctaHref: "#" },
        { id: "t2", name: "Pro", price: "$19", period: "/mo", description: "For growing teams.", features: ["25 projects", "Priority support", "Advanced features", "Custom domains"], highlighted: true, ctaLabel: "Choose Pro", ctaHref: "#" },
        { id: "t3", name: "Enterprise", price: "Custom", period: "", description: "For large teams.", features: ["Unlimited projects", "Dedicated support", "SLA guarantee"], highlighted: false, ctaLabel: "Contact Us", ctaHref: "#" },
      ],
    },
  },
  {
    type: "cta",
    label: "Call to Action",
    icon: "📢",
    description: "Bold CTA section to drive conversions",
    category: "conversion",
    defaults: {
      title: "Ready to get started?",
      subtitle: "Join thousands of builders shipping faster.",
      label: "Get Started",
      href: "#",
    },
  },
  {
    type: "gallery",
    label: "Gallery",
    icon: "🖼️",
    description: "Image gallery grid",
    category: "content",
    defaults: {
      title: "Gallery",
      subtitle: "A look at what we've built.",
      columns: 3,
      images: [
        { url: "https://placehold.co/400x300/9B4DFF/white?text=Image+1", alt: "Gallery image 1" },
        { url: "https://placehold.co/400x300/4DFF62/white?text=Image+2", alt: "Gallery image 2" },
        { url: "https://placehold.co/400x300/65F4FF/white?text=Image+3", alt: "Gallery image 3" },
      ],
    },
  },
  {
    type: "testimonial",
    label: "Testimonials",
    icon: "💬",
    description: "Customer testimonials with avatars",
    category: "content",
    defaults: {
      title: "Testimonials",
      subtitle: "Don't just take our word for it.",
      items: [
        { id: "tm1", quote: "This product changed how we work.", author: "Sarah Chen", role: "CEO, TechCorp", avatar: "" },
        { id: "tm2", quote: "Best decision we made all year.", author: "Mike Ross", role: "Founder, Startup", avatar: "" },
      ],
    },
  },
  {
    type: "footer",
    label: "Footer",
    icon: "📄",
    description: "Footer with links and copyright",
    category: "layout",
    defaults: {
      brand: "Brand",
      description: "Building the future, one project at a time.",
      links: [
        { label: "Privacy", href: "#" },
        { label: "Terms", href: "#" },
        { label: "Contact", href: "#" },
      ],
      copyright: "© 2026 Brand. All rights reserved.",
    },
  },
];

const CATEGORIES = [
  { id: "layout" as const, label: "Layout" },
  { id: "content" as const, label: "Content" },
  { id: "conversion" as const, label: "Conversion" },
];

// ─── Component ──────────────────────────────────────────────────

interface BlockPaletteProps {
  onAddBlock: (type: BlockType, content: Record<string, unknown>) => void;
  className?: string;
}

export function BlockPalette({ onAddBlock, className }: BlockPaletteProps) {
  const [activeCategory, setActiveCategory] = useState<"layout" | "content" | "conversion" | "all">("all");
  const [draggedBlock, setDraggedBlock] = useState<PaletteBlock | null>(null);

  const filtered = activeCategory === "all"
    ? PALETTE_BLOCKS
    : PALETTE_BLOCKS.filter((b) => b.category === activeCategory);

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Header */}
      <div className="border-b border-white/5 px-3 py-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-2">
          Blocks
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setActiveCategory("all")}
            className={cn(
              "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
              activeCategory === "all"
                ? "bg-cyan-500/20 text-cyan-300"
                : "text-white/40 hover:text-white/70 hover:bg-white/5",
            )}
          >
            All
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={cn(
                "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                activeCategory === cat.id
                  ? "bg-cyan-500/20 text-cyan-300"
                  : "text-white/40 hover:text-white/70 hover:bg-white/5",
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Block list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {filtered.map((block) => (
          <button
            key={block.type}
            draggable
            onDragStart={(e) => {
              setDraggedBlock(block);
              e.dataTransfer.setData("application/json", JSON.stringify({ type: block.type, content: block.defaults }));
              e.dataTransfer.effectAllowed = "copy";
            }}
            onDragEnd={() => setDraggedBlock(null)}
            onClick={() => onAddBlock(block.type, block.defaults)}
            className={cn(
              "group flex w-full items-start gap-2.5 rounded-lg border border-white/5 bg-white/[0.02] p-2.5 text-left transition-all hover:border-violet-500/30 hover:bg-violet-500/[0.05] cursor-grab active:cursor-grabbing",
              draggedBlock?.type === block.type && "opacity-50 border-violet-500/50",
            )}
          >
            <span className="text-lg shrink-0 mt-0.5">{block.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-white/90 group-hover:text-white">
                {block.label}
              </div>
              <div className="text-[10px] text-white/40 leading-tight mt-0.5">
                {block.description}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Footer hint */}
      <div className="border-t border-white/5 px-3 py-2">
        <div className="text-[9px] text-white/25 leading-tight">
          Click to add or drag onto canvas
        </div>
      </div>
    </div>
  );
}
