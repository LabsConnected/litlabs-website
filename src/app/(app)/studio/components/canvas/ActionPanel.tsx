"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ArtifactAction } from "@/lib/canvas/types";
import {
  PANEL_ACTION_CATEGORIES,
  resolvePanelActionAvailability,
  type PanelActionAvailability,
  type PanelActionCategory,
  type PanelActionDefinition,
} from "@/lib/canvas/panel-actions";

interface ActionPanelProps {
  open: boolean;
  onClose: () => void;
  projectId: string | null;
  onActionSelect: (action: ArtifactAction) => void;
}

const RECENT_KEY = "litt-action-panel-recent";
const MAX_RECENT = 3;

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writeRecent(ids: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, MAX_RECENT)));
  } catch {
    // Storage unavailable — recents just won't persist.
  }
}

/**
 * ActionPanel — the "What LiTT can do" menu for the Studio canvas.
 *
 * Renders as a bottom-anchored sheet inside the canvas container (absolute
 * overlay), so it works both in the desktop split-pane and inside the
 * mobile bottom sheet. Thumb-zone friendly: category pills scroll
 * horizontally, actions are a 2-column card grid.
 */
export function ActionPanel({ open, onClose, projectId, onActionSelect }: ActionPanelProps) {
  const [resolved, setResolved] = useState<
    { def: PanelActionDefinition; availability: PanelActionAvailability }[] | null
  >(null);
  const [activeCategory, setActiveCategory] = useState<PanelActionCategory | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [recentIds, setRecentIds] = useState<string[]>([]);

  // Resolve availability each time the panel opens (readiness can change).
  useEffect(() => {
    if (!open) return;
    setResolved(null);
    setSearchQuery("");
    setActiveCategory("all");
    setRecentIds(readRecent());
    let cancelled = false;
    void resolvePanelActionAvailability({ projectId }).then((items) => {
      if (!cancelled) setResolved(items);
    });
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const visible = useMemo(() => {
    if (!resolved) return [];
    const q = searchQuery.trim().toLowerCase();
    return resolved.filter(({ def }) => {
      if (activeCategory !== "all" && def.category !== activeCategory) return false;
      if (q && !`${def.label} ${def.description}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [resolved, activeCategory, searchQuery]);

  const recentItems = useMemo(() => {
    if (!resolved || searchQuery.trim() || activeCategory !== "all") return [];
    const byId = new Map(resolved.map((r) => [r.def.id, r]));
    return recentIds.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
  }, [resolved, recentIds, searchQuery, activeCategory]);

  if (!open) return null;

  const handleSelect = (def: PanelActionDefinition) => {
    let action: ArtifactAction;
    try {
      action = def.buildAction({ projectId });
    } catch {
      return;
    }
    setRecentIds((prev) => {
      const next = [def.id, ...prev.filter((id) => id !== def.id)].slice(0, MAX_RECENT);
      writeRecent(next);
      return next;
    });
    onActionSelect(action);
    onClose();
  };

  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center" role="dialog" aria-modal="true" aria-label="What LiTT can do">
      {/* Backdrop */}
      <button
        aria-label="Close action panel"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      />
      {/* Sheet */}
      <div className="relative flex max-h-[62vh] w-full flex-col rounded-t-2xl border-t border-white/10 bg-[#14141a] shadow-2xl">
        {/* Handle + header */}
        <div className="flex items-center justify-between px-4 pb-1 pt-2.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">What LiTT can do</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/15" aria-hidden="true" />

        {/* Search */}
        <div className="px-4 pb-2">
          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5">
            <Search size={14} className="shrink-0 text-white/40" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search actions…"
              aria-label="Search actions"
              className="w-full bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none"
            />
          </div>
        </div>

        {/* Category pills */}
        <div className="flex gap-1.5 overflow-x-auto px-4 pb-2.5" role="tablist" aria-label="Action categories">
          {PANEL_ACTION_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              role="tab"
              aria-selected={activeCategory === cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                activeCategory === cat.id
                  ? "border-accent/50 bg-accent/15 text-accent"
                  : "border-white/10 bg-white/5 text-white/55 hover:border-white/20 hover:text-white/80",
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Grid */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
          {resolved === null ? (
            <div className="grid grid-cols-2 gap-2" aria-label="Loading actions">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[76px] animate-pulse rounded-xl border border-white/5 bg-white/5" />
              ))}
            </div>
          ) : (
            <>
              {recentItems.length > 0 && (
                <div className="mb-3">
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/35">
                    Recent
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {recentItems.map(({ def, availability }) => (
                      <ActionCard key={def.id} def={def} availability={availability} onSelect={handleSelect} />
                    ))}
                  </div>
                </div>
              )}
              {visible.length === 0 ? (
                <div className="py-8 text-center text-sm text-white/35">
                  No actions match{searchQuery ? ` “${searchQuery}”` : ""}.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {visible.map(({ def, availability }) => (
                    <ActionCard key={def.id} def={def} availability={availability} onSelect={handleSelect} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionCard({
  def,
  availability,
  onSelect,
}: {
  def: PanelActionDefinition;
  availability: PanelActionAvailability;
  onSelect: (def: PanelActionDefinition) => void;
}) {
  const Icon = def.icon;
  const disabled = !availability.available;
  return (
    <button
      onClick={() => onSelect(def)}
      disabled={disabled}
      title={disabled ? availability.reason : def.description}
      className={cn(
        "flex flex-col gap-1 rounded-xl border p-3 text-left transition-all",
        disabled
          ? "cursor-not-allowed border-white/5 bg-white/[0.02] opacity-55"
          : "border-white/10 bg-white/5 hover:border-accent/40 hover:bg-accent/10 active:scale-[0.98]",
      )}
    >
      <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg", disabled ? "bg-white/5 text-white/35" : "bg-accent/15 text-accent")}>
        <Icon size={15} />
      </span>
      <span className="text-[13px] font-semibold text-white">{def.label}</span>
      <span className="line-clamp-2 text-[11px] leading-4 text-white/45">
        {disabled && availability.reason ? availability.reason : def.description}
      </span>
    </button>
  );
}
