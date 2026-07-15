"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, CornerDownLeft } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { TOOLS } from "./registry";
import type { StudioToolId } from "./studio-context";

export default function Launcher({
  open,
  setOpen,
  onPick,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  onPick: (id: StudioToolId) => void;
}) {
  const T = useTheme().resolvedColors;
  const [q, setQ] = useState("");
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(0);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return TOOLS;
    return TOOLS.filter(
      (t) =>
        t.label.toLowerCase().includes(term) ||
        t.desc.toLowerCase().includes(term) ||
        t.group.toLowerCase().includes(term),
    );
  }, [q]);

  type Row =
    | { kind: "header"; group: string }
    | { kind: "item"; index: number; tool: (typeof TOOLS)[number] };

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let lastGroup: string | null = null;
    filtered.forEach((tool, index) => {
      if (tool.group !== lastGroup) {
        out.push({ kind: "header", group: tool.group });
        lastGroup = tool.group;
      }
      out.push({ kind: "item", index, tool });
    });
    return out;
  }, [filtered]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const pick = filtered[active];
        if (pick) onPick(pick.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, active, onPick, setOpen]);

  useEffect(() => {
    rowRefs.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[18vh] px-4" onClick={() => setOpen(false)}>
      <div className="absolute inset-0" style={{ backgroundColor: "rgba(0,0,0,0.55)" }} />
      <div
        className="relative w-full max-w-xl rounded-2xl border overflow-hidden shadow-2xl"
        style={{ backgroundColor: T.boxBg, borderColor: T.borderColor + "40" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 h-12 border-b" style={{ borderColor: T.borderColor + "25" }}>
          <Search size={15} style={{ color: T.accentColor }} />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            placeholder="Search tools…"
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: T.textColor }}
          />
          <span className="text-[10px] px-1.5 py-0.5 rounded border" style={{ color: T.textMuted, borderColor: T.borderColor + "40" }}>esc</span>
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-1.5">
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-xs" style={{ color: T.textMuted }}>No matches.</div>
          )}
          {rows.map((row, ri) => {
            if (row.kind === "header") {
              return (
                <div key={`h-${ri}`} className="px-3 pt-3 pb-1 text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: T.textMuted + "90" }}>
                  {row.group}
                </div>
              );
            }
            const { index: i, tool: t } = row;
            const Icon = t.icon;
            const sel = i === active;
            return (
              <button
                key={t.id}
                ref={(el) => { rowRefs.current[i] = el; }}
                onMouseEnter={() => setActive(i)}
                onClick={() => onPick(t.id)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors"
                style={{ backgroundColor: sel ? T.accentColor + "15" : "transparent" }}
              >
                <span className="grid place-items-center w-8 h-8 rounded-lg shrink-0" style={{ backgroundColor: sel ? T.accentColor + "20" : T.bgColor + "60", color: sel ? T.accentColor : T.textMuted }}>
                  <Icon size={15} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-bold" style={{ color: sel ? T.headerColor : T.textColor }}>{t.label}</span>
                  <span className="block text-[10px]" style={{ color: T.textMuted }}>{t.desc}</span>
                </span>
                {sel && <CornerDownLeft size={12} style={{ color: T.textMuted }} />}
              </button>
            );
          })}
        </div>
        <div className="px-4 h-9 flex items-center justify-between border-t text-[10px]" style={{ borderColor: T.borderColor + "20", color: T.textMuted }}>
          <span>↑↓ navigate · ↵ select · esc close</span>
          <span>{filtered.length} tools</span>
        </div>
      </div>
    </div>
  );
}