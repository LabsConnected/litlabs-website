"use client";

/**
 * CommandPalette — Ctrl+K / Cmd+K command palette.
 *
 * Searches across:
 *   - Projects (open/recent)
 *   - Actions (Create Website/App/Game, Generate Image/Video, Create Music)
 *   - Developer (Open Studio/Preview/Terminal, View Deployment/Logs)
 *   - Media (Play track, Play recent media, Paste YouTube URL, Open Queue, Open Focus Mode)
 *   - Navigation (Dashboard/Create/Work/Showcase/Explore/Settings/Wallet)
 *
 * Invokes the same actions as the UI — does not duplicate logic.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft } from "lucide-react";
import type { CommandItem, CommandCategory } from "./types";
import type { DashboardProject, DashboardMediaItem } from "./types";
import type { MediaDockActions } from "./useMediaDock";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  projects: DashboardProject[];
  mediaItems: DashboardMediaItem[];
  mediaActions: MediaDockActions;
  onOpenFocusMode: () => void;
  onOpenQueue: () => void;
  onOpenDeveloperDrawer: () => void;
  onOpenTerminal: () => void;
}

const CATEGORY_LABELS: Record<CommandCategory, string> = {
  projects: "Projects",
  actions: "Actions",
  developer: "Developer",
  media: "Media",
  navigation: "Navigation",
};

const CATEGORY_ORDER: CommandCategory[] = [
  "projects",
  "actions",
  "developer",
  "media",
  "navigation",
];

export function CommandPalette({
  open,
  onClose,
  projects,
  mediaItems,
  mediaActions,
  onOpenFocusMode,
  onOpenQueue,
  onOpenDeveloperDrawer,
  onOpenTerminal,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIdx(0);
      // Focus input after render
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Build command items
  const allItems = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];

    // Projects
    for (const project of projects.slice(0, 5)) {
      const href = project.repository
        ? `/studio?project=${encodeURIComponent(project.id)}`
        : "/studio";
      items.push({
        id: `proj-${project.id}`,
        label: project.name,
        category: "projects",
        keywords: `project open ${project.name} ${project.branch}`,
        action: () => router.push(href),
      });
    }

    // Actions
    const actions: { label: string; href: string; keywords: string }[] = [
      { label: "Create Website", href: "/studio?tool=build&template=website", keywords: "create new website build" },
      { label: "Create App", href: "/studio?tool=build&template=app", keywords: "create new app build" },
      { label: "Create Game", href: "/studio?tool=build&template=game", keywords: "create new game build" },
      { label: "Generate Image", href: "/studio?tool=image", keywords: "create generate image art" },
      { label: "Generate Video", href: "/studio?tool=video", keywords: "create generate video" },
      { label: "Create Music", href: "/studio?tool=music", keywords: "create generate music audio" },
    ];
    for (const a of actions) {
      items.push({
        id: `action-${a.label}`,
        label: a.label,
        category: "actions",
        keywords: a.keywords,
        action: () => router.push(a.href),
      });
    }

    // Developer
    items.push(
      {
        id: "dev-studio",
        label: "Open Studio",
        category: "developer",
        keywords: "studio open code",
        action: () => router.push("/studio"),
      },
      {
        id: "dev-preview",
        label: "Open Preview",
        category: "developer",
        keywords: "preview open",
        action: () => router.push("/studio?tool=preview"),
      },
      {
        id: "dev-terminal",
        label: "Open Terminal",
        category: "developer",
        keywords: "terminal open shell",
        action: () => { onOpenTerminal(); onClose(); },
      },
      {
        id: "dev-deployment",
        label: "View Deployment",
        category: "developer",
        keywords: "deployment railway vercel view",
        action: () => { onOpenDeveloperDrawer(); onClose(); },
      },
      {
        id: "dev-logs",
        label: "View Logs",
        category: "developer",
        keywords: "logs view deployment",
        action: () => { onOpenDeveloperDrawer(); onClose(); },
      },
    );

    // Media
    // Play recent music tracks
    for (const item of mediaItems.filter((i) => i.type === "music" && i.track).slice(0, 3)) {
      items.push({
        id: `media-play-${item.id}`,
        label: `Play: ${item.title}`,
        category: "media",
        keywords: `play music track ${item.title}`,
        action: () => { mediaActions.playLittTrack(item.track!); onClose(); },
      });
    }
    items.push(
      {
        id: "media-youtube",
        label: "Paste YouTube URL…",
        category: "media",
        keywords: "youtube paste url video play",
        action: () => { onOpenQueue(); onClose(); },
      },
      {
        id: "media-queue",
        label: "Open Queue",
        category: "media",
        keywords: "queue open media",
        action: () => { onOpenQueue(); onClose(); },
      },
      {
        id: "media-focus",
        label: "Open Focus Mode",
        category: "media",
        keywords: "focus mode open media player",
        action: () => { onOpenFocusMode(); onClose(); },
      },
    );

    // Navigation
    const navItems: { label: string; href: string }[] = [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Create", href: "/studio?tool=image" },
      { label: "Work", href: "/projects" },
      { label: "Showcase", href: "/showcase" },
      { label: "Explore", href: "/discover" },
      { label: "Settings", href: "/settings" },
      { label: "Wallet", href: "/wallet" },
    ];
    for (const nav of navItems) {
      items.push({
        id: `nav-${nav.label}`,
        label: nav.label,
        category: "navigation",
        keywords: `go to navigate ${nav.label}`,
        action: () => router.push(nav.href),
      });
    }

    return items;
  }, [projects, mediaItems, mediaActions, router, onOpenTerminal, onOpenDeveloperDrawer, onOpenFocusMode, onOpenQueue, onClose]);

  // Filter items by query
  const filtered = useMemo(() => {
    if (!query.trim()) return allItems;
    const q = query.toLowerCase();
    return allItems.filter((item) => {
      const text = `${item.label} ${item.keywords || ""}`.toLowerCase();
      return text.includes(q);
    });
  }, [allItems, query]);

  // Group by category
  const grouped = useMemo(() => {
    const groups: Record<CommandCategory, CommandItem[]> = {
      projects: [],
      actions: [],
      developer: [],
      media: [],
      navigation: [],
    };
    for (const item of filtered) {
      groups[item.category].push(item);
    }
    return groups;
  }, [filtered]);

  // Flat list for keyboard navigation
  const flatList = useMemo(() => {
    return CATEGORY_ORDER.flatMap((cat) => grouped[cat]);
  }, [grouped]);

  // Reset selected index when query changes
  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, flatList.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = flatList[selectedIdx];
        if (item) {
          item.action();
          onClose();
        }
      }
    },
    [flatList, selectedIdx, onClose],
  );

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector(`[data-idx="${selectedIdx}"]`);
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIdx]);

  if (!open) return null;

  let runningIdx = 0;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border shadow-2xl"
        style={{
          background: "rgba(12,12,15,0.98)",
          borderColor: "rgba(255,255,255,0.08)",
          backdropFilter: "blur(20px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div
          className="flex items-center gap-3 border-b px-4 py-3"
          style={{ borderColor: "rgba(255,255,255,0.06)" }}
        >
          <Search size={18} style={{ color: "#71717a" }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects, actions, media…"
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: "#fafafa" }}
            onKeyDown={handleKeyDown}
          />
          <kbd
            className="rounded border px-1.5 py-0.5 font-mono text-[10px]"
            style={{ borderColor: "rgba(255,255,255,0.08)", color: "#71717a" }}
          >
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
          {flatList.length === 0 ? (
            <div className="py-8 text-center text-sm" style={{ color: "#71717a" }}>
              No results found
            </div>
          ) : (
            CATEGORY_ORDER.map((category) => {
              const items = grouped[category];
              if (items.length === 0) return null;
              return (
                <div key={category} className="mb-1">
                  <div
                    className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest"
                    style={{ color: "#52525b" }}
                  >
                    {CATEGORY_LABELS[category]}
                  </div>
                  {items.map((item) => {
                    const idx = runningIdx++;
                    const isSelected = idx === selectedIdx;
                    return (
                      <button
                        key={item.id}
                        data-idx={idx}
                        onClick={() => {
                          item.action();
                          onClose();
                        }}
                        onMouseEnter={() => setSelectedIdx(idx)}
                        className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition-colors"
                        style={{
                          background: isSelected ? "rgba(167,139,250,0.1)" : "transparent",
                          color: isSelected ? "#fafafa" : "#a1a1aa",
                        }}
                      >
                        <span>{item.label}</span>
                        {isSelected && (
                          <CornerDownLeft size={14} style={{ color: "#71717a" }} />
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
