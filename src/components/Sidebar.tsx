"use client";

import Link from "next/link";
import NextImage from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import { useProfile } from "@/context/ProfileContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import {
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Coins,
  Pin,
  EyeOff,
  MoreHorizontal,
  CrownIcon,
  Home,
} from "lucide-react";
import { useState, useCallback, useMemo, useEffect } from "react";
import {
  NAV_GROUPS,
  COLLAPSED_KEY,
  GROUP_EXPANDED_KEY,
  PINNED_KEY,
  HIDDEN_KEY,
  type NavGroup,
  type NavItem,
} from "@/lib/navigation";

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
}

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

function NavItemRow({
  item,
  accent,
  onClose,
  collapsed,
  isActive,
  depth = 0,
  onToggleExpand,
  expanded,
  hidden = false,
}: {
  item: NavItem;
  accent: string;
  onClose?: () => void;
  collapsed: boolean;
  isActive: (href?: string) => boolean;
  depth?: number;
  onToggleExpand?: () => void;
  expanded?: boolean;
  hidden?: boolean;
}) {
  const { resolvedColors: T } = useTheme();
  const active = isActive(item.href);
  const hasChildren = !!item.children?.length;
  const isChildActive = useMemo(
    () => hasChildren && item.children?.some((c) => isActive(c.href)),
    [hasChildren, item.children, isActive],
  );
  const groupActive = active || isChildActive;

  const iconColor = groupActive ? accent : T.textMuted;
  const baseClasses =
    "relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 group select-none hover:bg-white/5";
  const style = {
    backgroundColor: groupActive ? `${accent}14` : "transparent",
    color: groupActive ? accent : T.textMuted,
    paddingLeft: collapsed ? undefined : `${12 + depth * 8}px`,
    boxShadow: groupActive ? `inset 2px 0 0 0 ${accent}` : "none",
  };

  const icon = (
    <div className="relative shrink-0">
      <item.icon size={17} style={{ color: iconColor }} />
    </div>
  );

  const label = !collapsed ? (
    <span className="truncate">{item.label}</span>
  ) : null;

  if (hidden) return null;

  if (hasChildren) {
    return (
      <div className="space-y-0.5">
        <button
          onClick={onToggleExpand}
          className={baseClasses}
          style={style}
          type="button"
        >
          {icon}
          {label}
          {!collapsed && (
            <ChevronDown
              size={14}
              className="ml-auto shrink-0 transition-transform"
              style={{
                transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                color: iconColor,
              }}
            />
          )}
        </button>
        {expanded && !collapsed && (
          <div className="space-y-0.5 overflow-hidden transition-all duration-200">
            {item.children?.map((child) => (
              <NavItemRow
                key={child.href || child.label}
                item={child}
                accent={accent}
                onClose={onClose}
                collapsed={collapsed}
                isActive={isActive}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link href={item.href || "#"} onClick={onClose} className="block">
      <div className={baseClasses} style={style}>
        {icon}
        {label}
      </div>
    </Link>
  );
}

function GroupSection({
  group,
  collapsed,
  onClose,
  isActive,
  expanded,
  onToggle,
  hidden,
  isPinned,
}: {
  group: NavGroup;
  collapsed: boolean;
  onClose?: () => void;
  isActive: (href?: string) => boolean;
  expanded: boolean;
  onToggle: () => void;
  hidden: boolean;
  isPinned: boolean;
}) {
  const { resolvedColors: T } = useTheme();
  if (hidden) return null;

  return (
    <div
      className={`group-section ${group.label === "System" ? "pt-2 mt-2 border-t" : ""}`}
      style={{
        borderColor: group.label === "System" ? `${group.accent}20` : undefined,
      }}
    >
      {!collapsed && (
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-between px-3 py-1.5 mb-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all"
          style={{
            color: group.accent,
            backgroundColor: `${group.accent}12`,
          }}
          type="button"
        >
          <span className="flex items-center gap-1.5">
            <group.icon size={12} />
            {group.label}
          </span>
          <span className="flex items-center gap-1 opacity-70">
            {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </span>
        </button>
      )}
      {collapsed && (
        <div className="flex justify-center mb-2">
          <group.icon size={16} style={{ color: group.accent }} />
        </div>
      )}

      {!collapsed && expanded && (
        <div className="space-y-0.5">
          {group.items.map((item) => (
            <NavItemRow
              key={item.href || item.label}
              item={item}
              accent={group.accent}
              onClose={onClose}
              collapsed={collapsed}
              isActive={isActive}
            />
          ))}
        </div>
      )}

      {!collapsed && !expanded && isPinned && (
        <div className="space-y-0.5">
          {group.items
            .filter((i) => !i.children)
            .slice(0, 3)
            .map((item) => (
              <NavItemRow
                key={item.href || item.label}
                item={item}
                accent={group.accent}
                onClose={onClose}
                collapsed={collapsed}
                isActive={isActive}
              />
            ))}
        </div>
      )}

      {collapsed && (
        <div className="flex flex-col items-center gap-1">
          {group.items
            .filter((i) => !i.children)
            .map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href || item.label}
                  href={item.href || "#"}
                  onClick={onClose}
                  title={item.label}
                  aria-label={item.label}
                  className="flex items-center justify-center w-10 h-10 rounded-lg transition-colors hover:opacity-100"
                  style={{
                    backgroundColor: active
                      ? `${group.accent}20`
                      : "transparent",
                    color: active ? group.accent : T.textMuted,
                  }}
                >
                  <item.icon size={18} />
                </Link>
              );
            })}
        </div>
      )}
    </div>
  );
}

function SidebarContent({
  onClose,
  collapsed,
  onToggleCollapse,
}: {
  onClose?: () => void;
  collapsed: boolean;
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { resolvedColors: T } = useTheme();
  const { balance } = useWallet();
  const { profile } = useProfile();
  const { isSignedIn, userId, sessionClaims } = useClerkAuth();

  const [groupExpanded, setGroupExpanded] = useState<Record<string, boolean>>(
    () => {
      const saved = loadJson<Record<string, boolean>>(GROUP_EXPANDED_KEY, {});
      const defaults = Object.fromEntries(
        NAV_GROUPS.map((g) => [g.label, true]),
      );
      return { ...defaults, ...saved };
    },
  );
  const [pinned, setPinned] = useState<string[]>(() =>
    loadJson(PINNED_KEY, ["Dashboard", "Studio"]),
  );
  const [hidden, setHidden] = useState<string[]>(() =>
    loadJson(HIDDEN_KEY, []),
  );
  const [showPersonalize, setShowPersonalize] = useState(false);
  const [plan, setPlan] = useState<string>("free");

  useEffect(() => {
    if (!isSignedIn || !userId) return;
    let active = true;
    fetch(`/api/users/${userId}/plan`)
      .then((res) => (res.ok ? res.json() : { plan: "free" }))
      .then((data) => {
        if (active && data.plan) setPlan(data.plan);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isSignedIn, userId]);

  const isActive = useCallback(
    (href?: string) => {
      if (!href) return false;
      const [path, query] = href.split("?");
      const hrefParams = query
        ? new URLSearchParams(query)
        : new URLSearchParams();
      if (query) {
        const searchMatch = Array.from(hrefParams.entries()).every(
          ([key, value]) => searchParams.get(key) === value,
        );
        return pathname === path && searchMatch;
      }
      return pathname?.startsWith(path) ?? false;
    },
    [pathname, searchParams],
  );

  const toggleGroup = (label: string) => {
    setGroupExpanded((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      saveJson(GROUP_EXPANDED_KEY, next);
      return next;
    });
  };

  const togglePin = (label: string) => {
    setPinned((prev) => {
      const next = prev.includes(label)
        ? prev.filter((l) => l !== label)
        : [label, ...prev];
      saveJson(PINNED_KEY, next);
      return next;
    });
  };

  const toggleHidden = (label: string) => {
    setHidden((prev) => {
      const next = prev.includes(label)
        ? prev.filter((l) => l !== label)
        : [...prev, label];
      saveJson(HIDDEN_KEY, next);
      return next;
    });
  };

  const orderedGroups = useMemo(() => {
    return [...NAV_GROUPS].sort((a, b) => {
      if (a.label === "Dashboard") return -1;
      if (b.label === "Dashboard") return 1;
      const aPinned = pinned.includes(a.label);
      const bPinned = pinned.includes(b.label);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return 0;
    });
  }, [pinned]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-3 border-b"
        style={{ borderColor: `${T.borderColor}30` }}
      >
        {onClose && (
          <span
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: T.textMuted }}
          >
            Menu
          </span>
        )}
        {!onClose && (
          <Link
            href="/dashboard"
            className="flex items-center gap-2"
            aria-label="Dashboard home"
            title="Dashboard home"
          >
            {!collapsed && (
              <span
                className="text-xs font-bold uppercase tracking-widest"
                style={{ color: T.accentColor }}
              >
                LiTTree-LabStudios
              </span>
            )}
            {collapsed && (
              <span className="flex items-center justify-center w-8 h-8 rounded-lg">
                <Home size={18} style={{ color: T.accentColor }} />
              </span>
            )}
          </Link>
        )}
        <div className="flex items-center gap-1">
          {!collapsed && (
            <button
              onClick={() => setShowPersonalize((v) => !v)}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              style={{ color: T.textMuted }}
              title="Personalize sidebar"
            >
              <MoreHorizontal size={16} />
            </button>
          )}
          {onToggleCollapse && !onClose && (
            <button
              onClick={onToggleCollapse}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              style={{ color: T.textMuted }}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? (
                <ChevronRight size={16} />
              ) : (
                <ChevronLeft size={16} />
              )}
            </button>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close sidebar"
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
            style={{ color: T.textMuted }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* User profile card */}
      {!collapsed &&
        isSignedIn &&
        userId &&
        (() => {
          const avatarSrc = profile?.avatarUrl || null;
          const displayName =
            profile?.displayName ||
            sessionClaims?.name ||
            sessionClaims?.username ||
            "Creator";
          const username =
            profile?.username || sessionClaims?.username || "litree";
          const initial = displayName[0].toUpperCase();
          return (
            <div
              className="px-3 pt-3 pb-2 border-b"
              style={{ borderColor: `${T.borderColor}30` }}
            >
              <Link
                href="/profile"
                className="flex items-center gap-3 p-2.5 rounded-xl transition-all hover:bg-white/5 group"
              >
                {/* Avatar with gradient ring */}
                <div className="relative shrink-0">
                  <div
                    className="w-11 h-11 rounded-full p-[2px]"
                    style={{
                      background: `linear-gradient(135deg, ${T.accentColor}, #a855f7, #f472b6)`,
                    }}
                  >
                    <div className="w-full h-full rounded-full overflow-hidden">
                      {avatarSrc ? (
                        <NextImage
                          src={avatarSrc}
                          alt="Profile"
                          width={44}
                          height={44}
                          className="object-cover w-full h-full"
                        />
                      ) : (
                        <div
                          className="w-full h-full flex items-center justify-center text-sm font-black"
                          style={{
                            background: `linear-gradient(135deg, ${T.accentColor}30, #a855f730)`,
                            color: T.accentColor,
                          }}
                        >
                          {initial}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Online dot */}
                  <span
                    className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 bg-emerald-400"
                    style={{ borderColor: T.bgColor }}
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div
                    className="text-sm font-bold truncate leading-tight"
                    style={{ color: T.textColor }}
                  >
                    {displayName}
                  </div>
                  <div
                    className="text-[11px] truncate mt-0.5"
                    style={{ color: T.textMuted }}
                  >
                    @{username}
                  </div>
                </div>

                {/* Settings shortcut */}
                <Link
                  href="/settings?tab=profile"
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-white/10"
                  style={{ color: T.textMuted }}
                  title="Edit profile"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                </Link>
              </Link>
            </div>
          );
        })()}

      {/* The global FloatingChat (in layout.tsx) handles the Director
          experience now, so we no longer render the sidebar card/drawer. */}

      {/* Personalize panel */}
      {showPersonalize && !collapsed && (
        <div
          className="px-3 py-3 border-b space-y-3"
          style={{
            borderColor: `${T.borderColor}30`,
            backgroundColor: `${T.bgColor}60`,
          }}
        >
          <div className="space-y-1.5">
            <div
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: T.textMuted }}
            >
              Sections
            </div>
            <div className="flex flex-wrap gap-1">
              {NAV_GROUPS.map((g) => (
                <div
                  key={g.label}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold"
                  style={{
                    backgroundColor: hidden.includes(g.label)
                      ? `${T.borderColor}20`
                      : `${g.accent}20`,
                    border: `1px solid ${hidden.includes(g.label) ? T.borderColor : g.accent}40`,
                  }}
                >
                  <span
                    style={{
                      color: hidden.includes(g.label) ? T.textMuted : g.accent,
                    }}
                  >
                    {g.label}
                  </span>
                  <button
                    onClick={() => togglePin(g.label)}
                    className="p-0.5 rounded hover:bg-white/10"
                    title={pinned.includes(g.label) ? "Unpin" : "Pin to top"}
                    style={{
                      color: pinned.includes(g.label) ? g.accent : T.textMuted,
                    }}
                  >
                    <Pin
                      size={10}
                      style={{
                        fill: pinned.includes(g.label) ? g.accent : "none",
                      }}
                    />
                  </button>
                  <button
                    onClick={() => toggleHidden(g.label)}
                    className="p-0.5 rounded hover:bg-white/10"
                    title={hidden.includes(g.label) ? "Show" : "Hide"}
                    style={{
                      color: hidden.includes(g.label) ? g.accent : T.textMuted,
                    }}
                  >
                    <EyeOff size={10} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Navigation groups */}
      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-4">
        {orderedGroups.map((group) => (
          <GroupSection
            key={group.label}
            group={group}
            collapsed={collapsed}
            onClose={onClose}
            isActive={isActive}
            expanded={!!groupExpanded[group.label]}
            onToggle={() => toggleGroup(group.label)}
            hidden={hidden.includes(group.label)}
            isPinned={pinned.includes(group.label)}
          />
        ))}
      </nav>

      {/* Footer */}
      <div
        className="px-3 py-3 border-t"
        style={{ borderColor: `${T.borderColor}30` }}
      >
        {!collapsed && (
          <div className="space-y-1.5">
            <div
              className="flex items-center justify-between px-3 py-2 rounded-lg text-[10px] font-bold"
              style={{
                backgroundColor: T.bgColor + "30",
                border: `1px solid ${T.borderColor}20`,
              }}
            >
              <span
                className="flex items-center gap-1"
                style={{ color: "#fbbf24" }}
              >
                <Coins size={10} /> Balance
              </span>
              <span style={{ color: T.textColor }}>
                {balance.toLocaleString()} LBC
              </span>
            </div>
            <div
              className="flex items-center justify-between px-3 py-2 rounded-lg text-[10px] font-bold"
              style={{
                backgroundColor: T.bgColor + "30",
                border: `1px solid ${T.borderColor}20`,
              }}
            >
              <span
                className="flex items-center gap-1"
                style={{ color: T.accentColor }}
              >
                <CrownIcon size={10} /> Plan
              </span>
              <span style={{ color: T.textColor }}>
                {plan.charAt(0).toUpperCase() + plan.slice(1)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Sidebar({
  open = false,
  onClose,
  collapsed: externalCollapsed,
}: SidebarProps) {
  const { resolvedColors: T } = useTheme();
  const [internalCollapsed, setInternalCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(COLLAPSED_KEY) === "true";
  });

  const collapsed = externalCollapsed ?? internalCollapsed;

  const toggleCollapse = useCallback(() => {
    setInternalCollapsed((v) => {
      const next = !v;
      if (typeof window !== "undefined")
        localStorage.setItem(COLLAPSED_KEY, String(next));
      return next;
    });
  }, []);

  const sidebarBase = {
    backgroundColor: `${T.bgColor}f0`,
    borderColor: `${T.borderColor}30`,
  };

  return (
    <>
      <aside
        className={`hidden md:flex flex-col h-screen sticky top-0 border-r shrink-0 transition-all duration-300 ${
          collapsed ? "w-16" : "w-72"
        }`}
        style={sidebarBase}
      >
        <SidebarContent
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
        />
      </aside>

      {open && (
        <div className="fixed inset-0 z-[10000] md:hidden flex">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <aside
            className="relative flex flex-col w-80 h-full border-r shadow-2xl"
            style={sidebarBase}
          >
            <SidebarContent onClose={onClose} collapsed={false} />
          </aside>
        </div>
      )}
    </>
  );
}
