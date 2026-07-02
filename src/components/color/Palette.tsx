"use client";

import { useTheme } from "@/context/ThemeContext";

export type PaletteColor = {
  number: number;
  color: string;
  name: string;
};

export default function Palette({
  colors,
  active,
  onSelect,
  showNames,
}: {
  colors: PaletteColor[];
  active: number;
  onSelect: (number: number) => void;
  showNames?: boolean;
}) {
  const { resolvedColors: T } = useTheme();

  return (
    <div className="flex flex-wrap gap-2">
      {colors.map((c) => {
        const isActive = active === c.number;
        return (
          <button
            key={c.number}
            onClick={() => onSelect(c.number)}
            className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 transition-all ${
              isActive ? "ring-2 ring-offset-1 ring-offset-transparent scale-105" : "hover:scale-105"
            }`}
            style={{
              backgroundColor: T.boxBg,
              borderColor: isActive ? c.color : T.borderColor + "40",
              boxShadow: isActive ? `0 0 20px ${c.color}40` : "none",
            }}
            title={`${c.number} — ${c.name}`}
            aria-label={`Select color ${c.number} ${c.name}`}
          >
            <span
              className="w-6 h-6 rounded-full border"
              style={{ backgroundColor: c.color, borderColor: T.borderColor }}
            />
            <span className="text-sm font-bold" style={{ color: T.textColor }}>
              {c.number}
            </span>
            {showNames && (
              <span className="text-[10px] hidden sm:block" style={{ color: T.textMuted }}>
                {c.name}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
