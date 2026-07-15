"use client";

import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { Layout, Search, TrendingUp, Clock, Sparkles } from "lucide-react";

interface Template {
  id: string;
  name: string;
  category: string;
  description: string;
  thumbnail?: string;
  popular?: boolean;
  recent?: boolean;
  tags?: string[];
}

const TEMPLATES: Template[] = [
  {
    id: "1",
    name: "Hero Banner",
    category: "Marketing",
    description: "Eye-catching hero section with gradient background",
    popular: true,
  },
  {
    id: "2",
    name: "Product Card",
    category: "E-commerce",
    description: "Clean product display with hover effects",
    popular: true,
  },
  {
    id: "3",
    name: "Social Post",
    category: "Social",
    description: "Engaging social media post layout",
    recent: true,
  },
  {
    id: "4",
    name: "Landing Page",
    category: "Marketing",
    description: "High-converting landing page structure",
    popular: true,
  },
  {
    id: "5",
    name: "Dashboard",
    category: "UI",
    description: "Professional dashboard layout with charts",
    recent: true,
  },
  {
    id: "6",
    name: "Gallery Grid",
    category: "Media",
    description: "Responsive image gallery with lightbox",
  },
  {
    id: "7",
    name: "Form Design",
    category: "UI",
    description: "Clean form with validation states",
  },
  {
    id: "8",
    name: "Navigation",
    category: "UI",
    description: "Modern navigation menu design",
  },
];

interface TemplateLibraryProps {
  onTemplateSelect?: (template: Template) => void;
}

export default function TemplateLibrary({
  onTemplateSelect,
}: TemplateLibraryProps) {
  const { resolvedColors: T } = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [showPopular, setShowPopular] = useState(false);
  const [showRecent, setShowRecent] = useState(false);

  const categories = [
    "all",
    "Marketing",
    "E-commerce",
    "Social",
    "UI",
    "Media",
  ];

  const filteredTemplates = TEMPLATES.filter((template) => {
    const matchesCategory =
      selectedCategory === "all" || template.category === selectedCategory;
    const matchesSearch =
      template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesPopular = !showPopular || template.popular;
    const matchesRecent = !showRecent || template.recent;
    return matchesCategory && matchesSearch && matchesPopular && matchesRecent;
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Layout size={18} style={{ color: T.accentColor }} />
        <span className="text-sm font-bold" style={{ color: T.textColor }}>
          Templates
        </span>
      </div>

      <div
        className="flex items-center gap-2 px-3 py-2 rounded-lg"
        style={{
          backgroundColor: T.bgColor + "40",
          border: "1px solid " + T.borderColor + "30",
        }}
      >
        <Search size={12} style={{ color: T.textMuted }} />
        <input
          id="template-library-search"
          name="templateSearch"
          type="text"
          placeholder="Search templates..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 bg-transparent outline-none text-xs"
          style={{ color: T.textColor }}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {categories.map((category) => (
          <button
            key={category}
            onClick={() => setSelectedCategory(category)}
            className="px-2 py-1 rounded text-[10px] font-bold transition-all hover:scale-105 capitalize"
            style={{
              backgroundColor:
                selectedCategory === category
                  ? T.accentColor + "15"
                  : "transparent",
              color:
                selectedCategory === category ? T.accentColor : T.textMuted,
              border:
                selectedCategory === category
                  ? "1px solid " + T.accentColor + "30"
                  : "transparent",
            }}
          >
            {category}
          </button>
        ))}
        <button
          onClick={() => setShowPopular(!showPopular)}
          className="px-2 py-1 rounded text-[10px] font-bold transition-all hover:scale-105"
          style={{
            backgroundColor: showPopular ? T.accentColor + "15" : "transparent",
            color: showPopular ? T.accentColor : T.textMuted,
            border: showPopular
              ? "1px solid " + T.accentColor + "30"
              : "transparent",
          }}
        >
          <TrendingUp size={10} className="inline mr-1" />
          Popular
        </button>
        <button
          onClick={() => setShowRecent(!showRecent)}
          className="px-2 py-1 rounded text-[10px] font-bold transition-all hover:scale-105"
          style={{
            backgroundColor: showRecent ? T.accentColor + "15" : "transparent",
            color: showRecent ? T.accentColor : T.textMuted,
            border: showRecent
              ? "1px solid " + T.accentColor + "30"
              : "transparent",
          }}
        >
          <Clock size={10} className="inline mr-1" />
          Recent
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
        {filteredTemplates.map((template) => (
          <button
            key={template.id}
            onClick={() => onTemplateSelect?.(template)}
            className="p-3 rounded-lg text-left transition-all hover:scale-[1.02]"
            style={{
              backgroundColor: T.boxBg + "40",
              border: "1px solid " + T.borderColor + "20",
            }}
          >
            <div className="flex items-center gap-1 mb-1">
              {template.popular && (
                <TrendingUp size={10} style={{ color: "#f59e0b" }} />
              )}
              {template.recent && (
                <Clock size={10} style={{ color: "#8b5cf6" }} />
              )}
              <Sparkles size={10} style={{ color: T.accentColor }} />
            </div>
            <div
              className="text-[10px] font-bold truncate"
              style={{ color: T.textColor }}
            >
              {template.name}
            </div>
            <div className="text-[9px]" style={{ color: T.textMuted }}>
              {template.category}
            </div>
            <div
              className="text-[9px] mt-1 line-clamp-2"
              style={{ color: T.textMuted }}
            >
              {template.description}
            </div>
          </button>
        ))}
      </div>

      {filteredTemplates.length === 0 && (
        <div className="text-center py-4">
          <Layout
            size={24}
            className="mx-auto mb-2"
            style={{ color: T.textMuted }}
          />
          <p className="text-xs" style={{ color: T.textMuted }}>
            No templates found
          </p>
        </div>
      )}
    </div>
  );
}
