import { useEffect, useRef, useState } from "react";
import type { WorktabBadge } from "../stores/useExecutionStore";
import type { Worktab } from "../hooks/useServerWorktabs";

/* ── F1: WorktabBar ───────────────────────────────────────────────────
   Sits directly above the workspace. Tabs `[title] ×` + `[+]` + a
   recently-closed (↺) affordance that reopens server-closed tasks.

   Tabs are the DURABLE server model (GET/POST/PATCH /api/studio/tasks);
   this bar is shell UI over it (audit §3). Horizontal scroll at narrow
   widths (390px-safe: the bar itself scrolls, the page never overflows).

   Status badges derive ONLY from machine evidence (execution store
   per-task phases + server action-run projection, via useWorktabBadges):
   ● working (pulsing lime dot) / ✓ ready (lime check) /
   ⚠ needs approval (amber). Idle tabs show no badge. Never optimistic.
*/

export interface ClosedWorktab {
  id: string;
  title: string;
}

interface WorktabBarProps {
  tabs: Worktab[];
  activeId: string | null;
  badges: Record<string, WorktabBadge>;
  onSwitch: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  /** Server-closed tasks available for reopen (newest first). */
  closedTabs: ClosedWorktab[];
  onReopen: (id: string) => void;
}

function Badge({ badge, tabId }: { badge: WorktabBadge; tabId: string }) {
  if (badge === "working") {
    return (
      <span
        className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full"
        style={{ backgroundColor: "var(--litt-primary)" }}
        aria-label="Run in progress"
        data-testid={`worktab-badge-${tabId}`}
      />
    );
  }
  if (badge === "ready") {
    return (
      <span
        className="shrink-0 text-[11px] font-bold leading-none"
        style={{ color: "var(--litt-primary)" }}
        aria-label="Run complete"
        data-testid={`worktab-badge-${tabId}`}
      >
        ✓
      </span>
    );
  }
  if (badge === "needs-approval") {
    return (
      <span
        className="shrink-0 text-[11px] font-bold leading-none"
        style={{ color: "#f5b544" }}
        aria-label="Needs approval"
        data-testid={`worktab-badge-${tabId}`}
      >
        ⚠
      </span>
    );
  }
  return null;
}

export default function WorktabBar({
  tabs,
  activeId,
  badges,
  onSwitch,
  onClose,
  onNew,
  closedTabs,
  onReopen,
}: WorktabBarProps) {
  const [reopenOpen, setReopenOpen] = useState(false);
  const reopenRef = useRef<HTMLDivElement | null>(null);

  // Dismiss the recently-closed menu on outside tap / Escape.
  useEffect(() => {
    if (!reopenOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (reopenRef.current && !reopenRef.current.contains(e.target as Node)) {
        setReopenOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setReopenOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [reopenOpen]);

  return (
    <div
      className="glass-shell flex h-9 shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden border-b px-2"
      style={{
        backgroundColor: "rgba(13,9,22,0.85)",
        borderColor: "color-mix(in srgb, var(--color-accent) 12%, transparent)",
        scrollbarWidth: "thin",
      }}
      role="tablist"
      aria-label="Worktabs"
      data-testid="worktab-bar"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            data-testid={`worktab-${tab.id}`}
            className="flex max-w-[180px] shrink-0 items-center gap-0.5 rounded-md"
            style={isActive ? { backgroundColor: "color-mix(in srgb, var(--color-accent) 14%, transparent)" } : undefined}
          >
            <button
              type="button"
              onClick={() => onSwitch(tab.id)}
              className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]"
              style={{ color: isActive ? "var(--text-main)" : "var(--text-dim)" }}
              aria-label={`Switch to ${tab.title}`}
              title={tab.title}
              data-testid={`worktab-switch-${tab.id}`}
            >
              <Badge badge={badges[tab.id] ?? "idle"} tabId={tab.id} />
              <span className="truncate">{tab.title}</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              className="mr-0.5 grid h-6 w-6 shrink-0 place-items-center rounded text-[14px] leading-none opacity-60 transition-opacity hover:opacity-100"
              style={{ color: "var(--text-dim)" }}
              aria-label={`Close ${tab.title}`}
              title={`Close ${tab.title}`}
              data-testid={`worktab-close-${tab.id}`}
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={onNew}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[15px] font-bold transition-colors hover:bg-white/5"
        style={{ color: "var(--text-dim)" }}
        aria-label="New worktab"
        title="New worktab"
        data-testid="worktab-new"
      >
        +
      </button>
      {closedTabs.length > 0 && (
        <div ref={reopenRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setReopenOpen((v) => !v)}
            className="grid h-7 w-7 place-items-center rounded-md text-[13px] transition-colors hover:bg-white/5"
            style={{ color: "var(--text-dim)" }}
            aria-label={`Reopen closed worktab (${closedTabs.length} available)`}
            aria-expanded={reopenOpen}
            title="Reopen closed worktab"
            data-testid="worktab-reopen-toggle"
          >
            ↺
          </button>
          {reopenOpen && (
            <div
              className="absolute right-0 top-8 z-50 max-h-56 w-52 overflow-y-auto rounded-lg border p-1 shadow-xl"
              style={{
                backgroundColor: "rgba(13,9,22,0.98)",
                borderColor: "rgba(155,77,255,0.2)",
              }}
              role="menu"
              aria-label="Recently closed worktabs"
              data-testid="worktab-reopen-menu"
            >
              {closedTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setReopenOpen(false);
                    onReopen(tab.id);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] font-semibold transition-colors hover:bg-white/5"
                  style={{ color: "var(--text-main)" }}
                  title={tab.title}
                  data-testid={`worktab-reopen-${tab.id}`}
                >
                  <span aria-hidden>↺</span>
                  <span className="truncate">{tab.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
