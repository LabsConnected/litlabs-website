"use client";

import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import type { ColorTemplate } from "@/lib/color-templates";
import { COLOR_TEMPLATE_CATEGORIES } from "@/lib/color-templates";
import { Search } from "lucide-react";

export default function TemplateGallery({
  templates,
  onSelect,
}: {
  templates: ColorTemplate[];
  onSelect: (template: ColorTemplate) => void;
}) {
  const { resolvedColors: T } = useTheme();
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = templates.filter((t) => {
    const matchesCategory = category === "all" || t.category === category;
    const matchesSearch =
      t.title.toLowerCase().includes(search.toLowerCase()) ||
      t.category.toLowerCase().includes(search.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center">
        <div className="flex flex-wrap gap-1.5">
          {COLOR_TEMPLATE_CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className="px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all"
              style={{
                backgroundColor: category === c.id ? T.accentColor : T.boxBg,
                color: category === c.id ? "#000" : T.textMuted,
                border: `1px solid ${category === c.id ? T.accentColor : T.borderColor + "40"}`,
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-xl border w-full sm:w-64"
          style={{ backgroundColor: T.boxBg, borderColor: T.borderColor + "40" }}
        >
          <Search size={14} style={{ color: T.textMuted }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a template..."
            className="bg-transparent outline-none text-xs flex-1"
            style={{ color: T.textColor }}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-xs" style={{ color: T.textMuted }}>
          No templates found.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filtered.map((t) => (
            <button
              key={t.id}
              onClick={() => onSelect(t)}
              className="group rounded-2xl border p-3 text-left transition-all hover:-translate-y-1 hover:shadow-lg"
              style={{
                backgroundColor: T.bgColor + "70",
                borderColor: T.borderColor + "30",
              }}
            >
              <div
                className="aspect-square rounded-xl border mb-3 flex items-center justify-center text-4xl overflow-hidden"
                style={{ borderColor: T.borderColor + "30", backgroundColor: T.boxBg }}
                dangerouslySetInnerHTML={{ __html: t.svg }}
              />
              <div className="text-xs font-bold" style={{ color: T.textColor }}>
                {t.title}
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[9px] uppercase tracking-wider" style={{ color: T.textMuted }}>
                  {t.category}
                </span>
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded uppercase font-bold"
                  style={{
                    backgroundColor:
                      t.difficulty === "easy"
                        ? "#22c55e20"
                        : t.difficulty === "medium"
                        ? "#eab30820"
                        : "#ef444420",
                    color:
                      t.difficulty === "easy"
                        ? "#22c55e"
                        : t.difficulty === "medium"
                        ? "#eab308"
                        : "#ef4444",
                  }}
                >
                  {t.difficulty}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
