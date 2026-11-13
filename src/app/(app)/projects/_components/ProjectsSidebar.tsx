/**
 * ProjectsSidebar — the /projects content for the shared LiTTAppShell
 * sidebar slot.
 *
 * REAL CATEGORIES ONLY (Decision C): All Projects, Recent, Templates.
 * Favorites / Shared / Archived / Storage are concepts with no
 * backend (Phase 1 audit §3) and are deliberately NOT rendered —
 * no dead items, no invented counts. They return as named follow-ups
 * when their backends exist.
 *
 * "Recent" is a presentation over real data: projects updated inside
 * the recency window (the list is already recent-first end to end).
 * "Templates" opens the picker over the 5 real server-side templates.
 *
 * The Connected GitHub accounts chips that used to sit below the
 * grid live at the bottom of the sidebar now — same data
 * (GET /api/github/installations), same non-fatal semantics.
 */

import { Clock, FolderKanban, GitPullRequest, LayoutTemplate } from "lucide-react";
import type { AppShellColors } from "@/components/app-shell/LiTTAppShell";

export type ProjectsCategory = "all" | "recent" | "templates";

/** Recency window for the Recent category (audit §3.2 option b). */
export const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type SidebarInstallation = {
  id: number;
  account: string | null;
};

interface ProjectsSidebarProps {
  colors: AppShellColors;
  category: ProjectsCategory;
  onSelectCategory: (category: ProjectsCategory) => void;
  counts: { all: number; recent: number; templates: number };
  installations: SidebarInstallation[];
}

export default function ProjectsSidebar({
  colors: T,
  category,
  onSelectCategory,
  counts,
  installations,
}: ProjectsSidebarProps) {
  const items: {
    id: ProjectsCategory;
    label: string;
    count: number;
    icon: typeof FolderKanban;
  }[] = [
    { id: "all", label: "All Projects", count: counts.all, icon: FolderKanban },
    { id: "recent", label: "Recent", count: counts.recent, icon: Clock },
    { id: "templates", label: "Templates", count: counts.templates, icon: LayoutTemplate },
  ];

  return (
    <div className="flex h-full flex-col gap-6">
      <nav aria-label="Project categories">
        <p
          className="mb-3 text-[10px] font-black uppercase tracking-[0.2em]"
          style={{ color: T.accentColor }}
        >
          Browse
        </p>
        <ul className="flex flex-col gap-1">
          {items.map((item) => {
            const active = category === item.id;
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelectCategory(item.id)}
                  aria-current={active ? "page" : undefined}
                  className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-bold transition-colors"
                  style={{
                    backgroundColor: active ? `${T.accentColor}18` : "transparent",
                    color: active ? T.accentColor : T.textColor,
                    border: `1px solid ${active ? `${T.accentColor}45` : "transparent"}`,
                  }}
                >
                  <Icon size={16} style={{ color: active ? T.accentColor : T.textMuted }} />
                  <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-black"
                    style={{
                      backgroundColor: active ? `${T.accentColor}22` : `${T.textColor}0d`,
                      color: active ? T.accentColor : T.textMuted,
                    }}
                  >
                    {item.count}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {installations.length > 0 && (
        <div>
          <p
            className="mb-3 text-[10px] font-black uppercase tracking-[0.2em]"
            style={{ color: T.textMuted }}
          >
            Connected GitHub accounts
          </p>
          <div className="flex flex-wrap gap-2">
            {installations.map((i) => (
              <div
                key={String(i.id)}
                className="flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold"
                style={{
                  borderColor: `${T.accentColor}25`,
                  color: T.textColor,
                  backgroundColor: `${T.accentColor}08`,
                }}
              >
                <GitPullRequest size={10} style={{ color: T.accentColor }} />
                {i.account ?? `Installation ${i.id}`}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
