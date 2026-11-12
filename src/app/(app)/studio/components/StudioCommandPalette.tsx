"use client";

/**
 * StudioCommandPalette — Ctrl+K / Cmd+K command palette for Studio.
 *
 * Ported from the retired dashboard launchpad
 * (src/components/dashboard/v3/CommandPalette.tsx) into the canonical
 * Studio workspace. Same interaction model — fuzzy substring search,
 * grouped results, full keyboard navigation — but every action resolves
 * to a real Studio surface:
 *
 *   - Projects        → /studio?project=<id>
 *   - Actions         → Studio creator/workspace deep links
 *   - Developer       → StudioDock tabs, /deployments, mission control,
 *                       focus-workspace toggle
 *   - Media           → useMediaDock actions (MediaHub + LiTT audio) and
 *                       the Media Hub expanded drawer (queue + URL input)
 *   - Navigation      → real app routes
 *
 * Data hooks mount only while the palette is open, so a closed palette
 * costs nothing.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft } from "lucide-react";
import type {
  CommandItem,
  CommandCategory,
  DashboardProject,
  DashboardMediaItem,
} from "@/components/dashboard/v3/types";
import {
  useCanonicalProjects,
  useDashboardMedia,
} from "@/components/dashboard/v3/useDashboardData";
import { useMediaDock } from "@/components/dashboard/v3/useMediaDock";
import { useMediaHub } from "@/components/media/MediaHubProvider";

interface StudioCommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /** Open the StudioDock on the Terminal tab. */
  onOpenTerminal: () => void;
  /** Open the StudioDock on the Activity tab (run/deploy logs). */
  onOpenActivity: () => void;
  /** Toggle Studio's focus workspace (hides side panels, keeps state). */
  onToggleFocusWorkspace: () => void;
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

export function StudioCommandPalette(props: StudioCommandPaletteProps) {
  if (!props.open) return null;
  return <StudioCommandPaletteInner {...props} />;
}

function StudioCommandPaletteInner({
  onClose,
  onOpenTerminal,
  onOpenActivity,
  onToggleFocusWorkspace,
}: StudioCommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const canonicalProjects = useCanonicalProjects();
  const dashboardMedia = useDashboardMedia();
  const { actions: mediaActions } = useMediaDock();
  const mediaHub = useMediaHub();

  const projects: DashboardProject[] = canonicalProjects.projects;
  const mediaItems: DashboardMediaItem[] = dashboardMedia.items;

  // Reset on mount (the inner only mounts while open)
  useEffect(() => {
    setQuery("");
    setSelectedIdx(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

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

    // Actions — Studio creator/workspace deep links
    const actions: { label: string; href: string; keywords: string }[] = [
      { label: "Create Website", href: "/studio?tool=chat&mode=website", keywords: "create new website build" },
      { label: "Create App", href: "/studio?tool=build", keywords: "create new app build" },
      { label: "Create Game", href: "/studio?tool=game", keywords: "create new game build" },
      { label: "Generate Image", href: "/studio?tool=chat&mode=image", keywords: "create generate image art" },
      { label: "Generate Video", href: "/studio?tool=chat&mode=video", keywords: "create generate video" },
      { label: "Create Music", href: "/studio?tool=chat&mode=music", keywords: "create generate music audio" },
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

    // Developer — real Studio surfaces only
    items.push(
      {
        id: "dev-studio",
        label: "Open Studio",
        category: "developer",
        keywords: "studio open workspace",
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
        keywords: "terminal open shell dock",
        action: () => { onOpenTerminal(); onClose(); },
      },
      {
        id: "dev-activity",
        label: "View Activity & Logs",
        category: "developer",
        keywords: "activity logs runs dock",
        action: () => { onOpenActivity(); onClose(); },
      },
      {
        id: "dev-deployment",
        label: "View Deployment",
        category: "developer",
        keywords: "deployment railway vercel view",
        action: () => router.push("/deployments"),
      },
      {
        id: "dev-mission-control",
        label: "Mission Control",
        category: "developer",
        keywords: "mission control telemetry status",
        action: () => router.push("/studio/mission-control"),
      },
      {
        id: "dev-focus",
        label: "Toggle Focus Workspace",
        category: "developer",
        keywords: "focus workspace zen hide panels expand",
        action: () => { onToggleFocusWorkspace(); onClose(); },
      },
    );

    // Media — unified dock actions (MediaHub + LiTT audio) + queue drawer
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
        id: "media-url",
        label: "Add Media URL…",
        category: "media",
        keywords: "youtube spotify soundcloud paste url play",
        action: () => { mediaHub.showExpanded(); onClose(); },
      },
      {
        id: "media-queue",
        label: "Open Queue",
        category: "media",
        keywords: "queue open media up next",
        action: () => { mediaHub.showExpanded(); onClose(); },
      },
      {
        id: "media-focus",
        label: "Open Focus Workspace",
        category: "media",
        keywords: "focus workspace zen mode",
        action: () => { onToggleFocusWorkspace(); onClose(); },
      },
    );

    // Navigation — real routes only
    const navItems: { label: string; href: string }[] = [
      { label: "Studio", href: "/studio" },
      { label: "Projects", href: "/projects" },
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
  }, [
    projects,
    mediaItems,
    mediaActions,
    mediaHub,
    router,
    onOpenTerminal,
    onOpenActivity,
    onToggleFocusWorkspace,
    onClose,
  ]);

  const filtered = useMemo(() => {
    if (!query.trim()) return allItems;
    const q = query.toLowerCase();
    return allItems.filter((item) => {
      const text = `${item.label} ${item.keywords || ""}`.toLowerCase();
      return text.includes(q);
    });
  }, [allItems, query]);

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

  const flatList = useMemo(
    () => CATEGORY_ORDER.flatMap((cat) => grouped[cat]),
    [grouped],
  );

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

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

  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector(`[data-idx="${selectedIdx}"]`);
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIdx]);

  let runningIdx = 0;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
      onKeyDown={handleKeyDown}
      data-testid="studio-command-palette"
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
            data-testid="studio-command-palette-input"
          />
          <kbd
            className="rounded border px-1.5 py-0.5 font-mono text-[10px]"
            style={{ borderColor: "rgba(255,255,255,0.08)", color: "#71717a" }}
          >
            ESC
          </kbd>
        </div>

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
                        type="button"
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
