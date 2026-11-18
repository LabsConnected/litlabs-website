"use client";

/**
 * SettingsSidebar — the section navigation rendered inside the shared
 * LiTTAppShell frame on /settings (Settings redesign Phase 2, following
 * the Phase 1 audit: the sidebar is a rendering change over the data
 * model that already exists — SETTINGS_GROUPS / SETTINGS_SECTIONS in
 * the settings store — not an information-architecture migration).
 *
 * It renders identically in the shell's desktop sidebar and its mobile
 * drawer: a back link (the page's returnTo target), a search input
 * that filters the section list, and the grouped section list. When a
 * search query is present it shows the flat filtered list, matching
 * the behavior of the tab strip this replaces.
 *
 * Section ids come straight from SETTINGS_SECTIONS and are never
 * renamed here — ?section= deep links key off them.
 */

import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  Briefcase,
  Check,
  ChevronRight,
  Cpu,
  Gauge,
  LayoutGrid,
  Mic,
  Palette,
  Plug,
  Search,
  Shield,
  Sparkles,
  Terminal,
  User,
} from "lucide-react";
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from "@/stores/useSettingsStore";
import type { AppShellColors } from "@/components/app-shell/LiTTAppShell";

const ICONS: Record<
  string,
  React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>
> = {
  LayoutGrid,
  User,
  Palette,
  Sparkles,
  Briefcase,
  Cpu,
  Bot,
  Mic,
  Plug,
  Shield,
  Gauge,
  Terminal,
};

interface SettingsSidebarProps {
  colors: AppShellColors;
  /** Sections after the search filter is applied. */
  sections: SettingsSection[];
  activeSection: string;
  onSectionClick: (id: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  /** Target for the back link (the page's ?returnTo= value). */
  returnTo: string;
}

export default function SettingsSidebar({
  colors,
  sections,
  activeSection,
  onSectionClick,
  searchQuery,
  onSearchChange,
  returnTo,
}: SettingsSidebarProps) {
  const hasSearch = searchQuery.trim().length > 0;

  const renderSectionButton = (section: SettingsSection) => {
    const Icon = ICONS[section.icon] ?? LayoutGrid;
    const isActive = activeSection === section.id;
    return (
      <button
        key={section.id}
        type="button"
        onClick={() => onSectionClick(section.id)}
        className="flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2"
        style={{
          borderColor: isActive ? `${colors.accentColor}73` : `${colors.borderColor}55`,
          backgroundColor: isActive ? `${colors.accentColor}14` : "transparent",
        }}
        aria-current={isActive ? "page" : undefined}
        aria-label={section.label}
        title={section.description}
      >
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
          style={{
            backgroundColor: `${colors.accentColor}14`,
            color: colors.accentColor,
          }}
        >
          <Icon size={16} className="pointer-events-none" />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block text-sm font-bold"
            style={{ color: isActive ? colors.accentColor : colors.textColor }}
          >
            {section.label}
          </span>
          <span
            className="block truncate text-xs"
            style={{ color: colors.textMuted }}
          >
            {section.description}
          </span>
        </span>
        {isActive ? (
          <Check size={16} className="shrink-0" style={{ color: colors.accentColor }} />
        ) : (
          <ChevronRight size={15} className="shrink-0" style={{ color: colors.textMuted }} />
        )}
      </button>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-4 flex items-center gap-3">
        <Link
          href={returnTo}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border transition-colors"
          style={{ borderColor: `${colors.borderColor}55`, color: colors.textMuted }}
          aria-label="Back to Studio"
        >
          <ArrowLeft size={16} className="pointer-events-none" />
        </Link>
        <div className="min-w-0">
          <p className="text-base font-black" style={{ color: colors.textColor }}>
            Settings
          </p>
          <p className="truncate text-xs" style={{ color: colors.textMuted }}>
            Choose a category
          </p>
        </div>
      </div>

      <div className="relative mb-4">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
          style={{ color: colors.textMuted }}
        />
        <input
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search settings…"
          className="w-full rounded-xl border py-2 pl-9 pr-3 text-sm outline-none transition-all focus:ring-2"
          style={{
            backgroundColor: colors.boxBg,
            borderColor: `${colors.borderColor}55`,
            color: colors.textColor,
          }}
          aria-label="Search settings"
          data-testid="settings-sidebar-search"
        />
      </div>

      <nav
        className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain"
        aria-label="Settings sections"
        data-testid="settings-sidebar-sections"
      >
        {hasSearch ? (
          sections.length > 0 ? (
            sections.map(renderSectionButton)
          ) : (
            <p className="px-1 py-2 text-sm" style={{ color: colors.textMuted }}>
              No settings match “{searchQuery}”.
            </p>
          )
        ) : (
          SETTINGS_GROUPS.map((group) => {
            const groupSections = SETTINGS_SECTIONS.filter((s) => s.group === group.id);
            if (groupSections.length === 0) return null;
            return (
              <div key={group.id} data-testid={`settings-sidebar-group-${group.id}`}>
                <h2
                  className="px-1 pb-1 pt-3 text-[10px] font-black uppercase tracking-[0.16em]"
                  style={{ color: colors.textMuted }}
                >
                  {group.label}
                </h2>
                <div className="space-y-2">{groupSections.map(renderSectionButton)}</div>
              </div>
            );
          })
        )}
      </nav>
    </div>
  );
}
