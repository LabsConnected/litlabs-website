"use client";

import { useState, type ComponentType } from "react";
import { useTheme } from "@/context/ThemeContext";
import { Search, Download, Sparkles, Filter, Star, Users, TrendingUp, Code, Palette, Music, Pencil, BarChart3, Globe, Shield, Zap } from "lucide-react";

interface StockAgent {
  id: string;
  name: string;
  role: string;
  description: string;
  category: string;
  icon: string;
  color: string;
  popularity: number;
  downloads: number;
  tags: string[];
  installed?: boolean;
}

const STOCK_AGENTS: StockAgent[] = [
  {
    id: "director",
    name: "Director",
    role: "Orchestrator",
    description: "Strategic command center for your AI team. Plans, delegates, and ensures quality.",
    category: "Core",
    icon: "brain",
    color: "#00ffff",
    popularity: 98,
    downloads: 12450,
    tags: ["Strategy", "Planning", "QA"],
    installed: true,
  },
  {
    id: "forge",
    name: "Forge",
    role: "Software Engineer",
    description: "Production-ready code across the full stack. TypeScript, React, Next.js, APIs.",
    category: "Dev",
    icon: "code",
    color: "#22d3ee",
    popularity: 96,
    downloads: 9870,
    tags: ["TypeScript", "React", "Next.js"],
    installed: true,
  },
  {
    id: "pulse",
    name: "Pulse",
    role: "Growth Strategist",
    description: "Growth, content, SEO, and analytics. Thinks in funnels and retention loops.",
    category: "Growth",
    icon: "trending",
    color: "#f472b6",
    popularity: 92,
    downloads: 8230,
    tags: ["Marketing", "SEO", "Analytics"],
    installed: true,
  },
  {
    id: "visionary",
    name: "Visionary",
    role: "Creative Director",
    description: "Image generation, brand identity, UI/UX, and creative direction.",
    category: "Creative",
    icon: "image",
    color: "#e879f9",
    popularity: 94,
    downloads: 7560,
    tags: ["Image Gen", "Design", "Brand"],
    installed: true,
  },
  {
    id: "champion",
    name: "Champion",
    role: "General Assistant",
    description: "Versatile all-rounder for everyday tasks, questions, and quick help.",
    category: "Core",
    icon: "sparkles",
    color: "#fbbf24",
    popularity: 88,
    downloads: 6890,
    tags: ["General", "Assistant", "Help"],
    installed: true,
  },
  {
    id: "code-champion",
    name: "Code Champion",
    role: "Code Reviewer",
    description: "Reviews code, catches bugs, suggests refactors, and explains logic.",
    category: "Dev",
    icon: "code",
    color: "#34d399",
    popularity: 85,
    downloads: 5420,
    tags: ["Code Review", "Debugging", "Refactor"],
  },
  {
    id: "data-slayer",
    name: "Data Slayer",
    role: "Data Scientist",
    description: "Analyzes data, builds reports, and creates visualizations.",
    category: "Analytics",
    icon: "chart",
    color: "#60a5fa",
    popularity: 82,
    downloads: 4890,
    tags: ["Data", "Reports", "Python"],
  },
  {
    id: "social-dominator",
    name: "Social Dominator",
    role: "Social Media Manager",
    description: "Creates posts, schedules content, and tracks engagement.",
    category: "Growth",
    icon: "globe",
    color: "#fb923c",
    popularity: 80,
    downloads: 4230,
    tags: ["Social", "Content", "Scheduling"],
  },
  {
    id: "writing-coach",
    name: "Writing Coach",
    role: "Content Writer",
    description: "Helps write, edit, and refine long-form and short-form content.",
    category: "Creative",
    icon: "pencil",
    color: "#a78bfa",
    popularity: 87,
    downloads: 6120,
    tags: ["Writing", "Editing", "Copy"],
  },
  {
    id: "music-producer",
    name: "Music Producer",
    role: "Music Generation",
    description: "Creates music, sound effects, and audio concepts.",
    category: "Creative",
    icon: "music",
    color: "#f87171",
    popularity: 78,
    downloads: 3890,
    tags: ["Music", "Audio", "Sound"],
  },
  {
    id: "security-guard",
    name: "Security Guard",
    role: "Security Analyst",
    description: "Reviews code for security issues and suggests best practices.",
    category: "Dev",
    icon: "shield",
    color: "#22c55e",
    popularity: 75,
    downloads: 3450,
    tags: ["Security", "Audit", "Best Practices"],
  },
  {
    id: "speed-demon",
    name: "Speed Demon",
    role: "Performance Optimizer",
    description: "Analyzes performance bottlenecks and suggests optimizations.",
    category: "Dev",
    icon: "zap",
    color: "#f59e0b",
    popularity: 73,
    downloads: 3120,
    tags: ["Performance", "Optimization", "Speed"],
  },
];

const ICONS: Record<string, ComponentType<{ className?: string; size?: number; style?: React.CSSProperties }>> = {
  brain: Sparkles,
  sparkles: Sparkles,
  code: Code,
  image: Palette,
  chart: BarChart3,
  music: Music,
  pencil: Pencil,
  trending: TrendingUp,
  globe: Globe,
  zap: Zap,
  shield: Shield,
};

interface StockAgentLibraryProps {
  onInstall?: (agent: StockAgent) => void;
  onClose?: () => void;
}

export default function StockAgentLibrary({ onInstall, onClose }: StockAgentLibraryProps) {
  const { resolvedColors: T } = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [sortBy, setSortBy] = useState<"popular" | "downloads" | "name">("popular");
  const [installed, setInstalled] = useState<Set<string>>(new Set(STOCK_AGENTS.filter(a => a.installed).map(a => a.id)));

  const categories = ["all", "Core", "Dev", "Growth", "Creative", "Analytics"];

  const filteredAgents = STOCK_AGENTS
    .filter(agent => {
      const matchesCategory = selectedCategory === "all" || agent.category === selectedCategory;
      const matchesSearch = agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            agent.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            agent.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesCategory && matchesSearch;
    })
    .sort((a, b) => {
      if (sortBy === "popular") return b.popularity - a.popularity;
      if (sortBy === "downloads") return b.downloads - a.downloads;
      return a.name.localeCompare(b.name);
    });

  const handleInstall = (agent: StockAgent) => {
    const newInstalled = new Set(installed);
    if (newInstalled.has(agent.id)) {
      newInstalled.delete(agent.id);
    } else {
      newInstalled.add(agent.id);
    }
    setInstalled(newInstalled);
    onInstall?.(agent);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Download size={20} style={{ color: T.accentColor }} />
          <span className="text-lg font-black" style={{ color: T.textColor }}>Stock Agent Library</span>
        </div>
        <button onClick={onClose} className="p-1 rounded-lg transition-all hover:scale-110" style={{ color: T.textMuted }}>
          ×
        </button>
      </div>

      {/* Search & Filters */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{ backgroundColor: T.bgColor + "40", border: "1px solid " + T.borderColor + "30" }}>
          <Search size={14} style={{ color: T.textMuted }} />
          <input
            type="text"
            placeholder="Search agents by name, role, or tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: T.textColor }}
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className="px-2 py-1 rounded-lg text-[10px] font-bold transition-all hover:scale-105 capitalize"
              style={{
                backgroundColor: selectedCategory === category ? T.accentColor + "15" : T.boxBg + "40",
                color: selectedCategory === category ? T.accentColor : T.textMuted,
                border: selectedCategory === category ? "1px solid " + T.accentColor + "30" : "1px solid " + T.borderColor + "30",
              }}
            >
              {category}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Filter size={12} style={{ color: T.textMuted }} />
          <span className="text-[10px] font-bold" style={{ color: T.textMuted }}>Sort by:</span>
          {(["popular", "downloads", "name"] as const).map((sort) => (
            <button
              key={sort}
              onClick={() => setSortBy(sort)}
              className="px-2 py-1 rounded text-[10px] font-bold transition-all capitalize"
              style={{
                backgroundColor: sortBy === sort ? T.accentColor + "15" : "transparent",
                color: sortBy === sort ? T.accentColor : T.textMuted,
              }}
            >
              {sort}
            </button>
          ))}
        </div>
      </div>

      {/* Agent Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[500px] overflow-y-auto">
        {filteredAgents.map((agent) => {
          const Icon = ICONS[agent.icon] || Sparkles;
          const isInstalled = installed.has(agent.id);
          return (
            <div
              key={agent.id}
              className="p-4 rounded-xl border transition-all hover:scale-[1.02]"
              style={{
                backgroundColor: T.boxBg + "40",
                borderColor: isInstalled ? agent.color + "30" : T.borderColor + "30",
                boxShadow: isInstalled ? `0 0 15px ${agent.color}15` : "none",
              }}
            >
              <div className="flex items-start gap-3 mb-3">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: agent.color + "15", border: "1px solid " + agent.color + "30" }}>
                  <Icon size={22} style={{ color: agent.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold truncate" style={{ color: T.textColor }}>{agent.name}</span>
                    {isInstalled && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ backgroundColor: agent.color + "20", color: agent.color }}>
                        Installed
                      </span>
                    )}
                  </div>
                  <div className="text-[10px]" style={{ color: agent.color }}>{agent.role}</div>
                  <div className="text-[10px] mt-1" style={{ color: T.textMuted }}>{agent.description}</div>
                </div>
              </div>

              <div className="flex items-center justify-between text-[10px] mb-3" style={{ color: T.textMuted }}>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <Star size={10} style={{ color: "#f59e0b" }} /> {agent.popularity}%
                  </span>
                  <span className="flex items-center gap-1">
                    <Download size={10} /> {agent.downloads.toLocaleString()}
                  </span>
                </div>
                <span className="px-1.5 py-0.5 rounded" style={{ backgroundColor: T.accentColor + "10", color: T.accentColor }}>
                  {agent.category}
                </span>
              </div>

              <div className="flex flex-wrap gap-1 mb-3">
                {agent.tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded font-bold"
                    style={{ backgroundColor: T.bgColor + "40", color: T.textMuted }}>
                    {tag}
                  </span>
                ))}
              </div>

              <button
                onClick={() => handleInstall(agent)}
                className="w-full py-2 rounded-lg text-xs font-bold transition-all hover:scale-105"
                style={{
                  backgroundColor: isInstalled ? "#ef444420" : agent.color + "15",
                  color: isInstalled ? "#ef4444" : agent.color,
                  border: isInstalled ? "1px solid #ef444430" : "1px solid " + agent.color + "30",
                }}
              >
                {isInstalled ? "Uninstall" : "Install Agent"}
              </button>
            </div>
          );
        })}
      </div>

      {filteredAgents.length === 0 && (
        <div className="text-center py-8">
          <Search size={32} className="mx-auto mb-2" style={{ color: T.textMuted }} />
          <p className="text-sm" style={{ color: T.textMuted }}>No agents found</p>
        </div>
      )}
    </div>
  );
}
