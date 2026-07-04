"use client";

import Link from "next/link";
import NextImage from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import { useProfile } from "@/context/ProfileContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useUser } from "@clerk/nextjs";
import {
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Bot,
  Coins,
  Pin,
  EyeOff,
  Send,
  MoreHorizontal,
  CrownIcon,
  Home,
} from "lucide-react";
import { useState, useCallback, useMemo, useEffect } from "react";
import {
  NAV_GROUPS,
  AI_SUGGESTIONS,
  CREATOR_MODES,
  COLLAPSED_KEY,
  GROUP_EXPANDED_KEY,
  PINNED_KEY,
  HIDDEN_KEY,
  MODE_KEY,
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
    [hasChildren, item.children, isActive]
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
      {item.online && !collapsed && (
        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-500 ring-1 ring-[#0a0b14]" />
      )}
    </div>
  );

  const label = !collapsed ? (
    <span className="truncate">{item.label}</span>
  ) : null;

  const badge = !collapsed && item.badge ? (
    <span
      className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full"
      style={{ backgroundColor: accent, color: "#0a0b14" }}
    >
      {item.badge > 99 ? "99+" : item.badge}
    </span>
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
          {badge}
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
        {badge}
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
  if (hidden) return null;

  return (
    <div className={`group-section ${group.label === "System" ? "pt-2 mt-2 border-t" : ""}`} style={{ borderColor: group.label === "System" ? `${group.accent}20` : undefined }}>
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
                    backgroundColor: active ? `${group.accent}20` : "transparent",
                    color: active ? group.accent : `${group.accent}80`,
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
  const { isSignedIn } = useClerkAuth();
  const { user } = useUser();

  const [groupExpanded, setGroupExpanded] = useState<Record<string, boolean>>(() => {
    const saved = loadJson<Record<string, boolean>>(GROUP_EXPANDED_KEY, {});
    const defaults = Object.fromEntries(NAV_GROUPS.map((g) => [g.label, true]));
    return { ...defaults, ...saved };
  });
  const [pinned, setPinned] = useState<string[]>(() => loadJson(PINNED_KEY, ["Home", "Social", "Gaming"]));
  const [hidden, setHidden] = useState<string[]>(() => loadJson(HIDDEN_KEY, []));
  const [mode, setMode] = useState<string>(() => {
    if (typeof window === "undefined") return "creator";
    return localStorage.getItem(MODE_KEY) || "creator";
  });
  const [showPersonalize, setShowPersonalize] = useState(false);
  const [aiQuery, setAiQuery] = useState("");
  const [jarvisFocused, setJarvisFocused] = useState(false);
  const [plan, setPlan] = useState<string>("free");

  useEffect(() => {
    if (!isSignedIn || !user?.id) return;
    let active = true;
    fetch(`/api/users/${user.id}/plan`)
      .then((res) => (res.ok ? res.json() : { plan: "free" }))
      .then((data) => {
        if (active && data.plan) setPlan(data.plan);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isSignedIn, user?.id]);

  const isActive = useCallback(
    (href?: string) => {
      if (!href) return false;
      const [path, query] = href.split("?");
      const hrefParams = query ? new URLSearchParams(query) : new URLSearchParams();
      if (query) {
        const searchMatch = Array.from(hrefParams.entries()).every(
          ([key, value]) => searchParams.get(key) === value
        );
        return pathname === path && searchMatch;
      }
      return pathname?.startsWith(path) ?? false;
    },
    [pathname, searchParams]
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
      const next = prev.includes(label) ? prev.filter((l) => l !== label) : [label, ...prev];
      saveJson(PINNED_KEY, next);
      return next;
    });
  };

  const toggleHidden = (label: string) => {
    setHidden((prev) => {
      const next = prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label];
      saveJson(HIDDEN_KEY, next);
      return next;
    });
  };

  const setCreatorMode = (value: string) => {
    setMode(value);
    if (typeof window !== "undefined") localStorage.setItem(MODE_KEY, value);
  };

  const orderedGroups = useMemo(() => {
    const pinnedFirst = [...NAV_GROUPS].sort((a, b) => {
      const aPinned = pinned.includes(a.label);
      const bPinned = pinned.includes(b.label);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return 0;
    });
    return pinnedFirst;
  }, [pinned]);

  const handleJarvisSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiQuery.trim()) return;
    // Best-effort navigation: search all nav items and match label
    const match = NAV_GROUPS.flatMap((g) => g.items).find(
      (i) =>
        i.label.toLowerCase().includes(aiQuery.toLowerCase()) ||
        aiQuery.toLowerCase().includes(i.label.toLowerCase())
    );
    if (match?.href) window.location.href = match.href;
    else window.location.href = `/agents?query=${encodeURIComponent(aiQuery)}`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-3 border-b"
        style={{ borderColor: `${T.borderColor}30` }}
      >
        {onClose && (
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>
            Menu
          </span>
        )}
        {!onClose && (
          <Link href="/dashboard" className="flex items-center gap-2">
            {!collapsed && (
              <span className="text-xs font-bold uppercase tracking-widest" style={{ color: T.accentColor }}>
                LiTTree OS
              </span>
            )}
            {collapsed && <Home size={16} style={{ color: T.accentColor }} />}
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
              {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          )}
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors" style={{ color: T.textMuted }}>
            <X size={16} />
          </button>
        )}
      </div>

      {/* User profile card */}
      {!collapsed && isSignedIn && user && (
        <div
          className="px-3 py-3 border-b"
          style={{ borderColor: `${T.borderColor}30` }}
        >
          <Link
            href="/profile"
            className="flex items-center gap-3 p-2 rounded-lg transition-colors hover:bg-white/5"
          >
            <div className="relative shrink-0 w-10 h-10 rounded-full overflow-hidden border-2" style={{ borderColor: T.accentColor }}>
              {user.imageUrl ? (
                <NextImage
                  src={user.imageUrl}
                  alt="Profile"
                  fill
                  className="object-cover"
                  sizes="40px"
                />
              ) : (
                <div
                  className="w-full h-full flex items-center justify-center text-sm font-bold"
                  style={{ backgroundColor: T.boxBg, color: T.accentColor }}
                >
                  {(user.firstName?.[0] || user.username?.[0] || "?").toUpperCase()}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold truncate" style={{ color: T.textColor }}>
                {profile?.displayName || user.firstName || user.username || "Creator"}
              </div>
              <div className="text-xs truncate" style={{ color: T.textMuted }}>
                @{user.username || "litree"}
              </div>
            </div>
          </Link>
        </div>
      )}

      {/* Jarvis / AI assistant */}
      {!collapsed && (
        <div className="px-3 py-3 border-b" style={{ borderColor: `${T.borderColor}30` }}>
          <form onSubmit={handleJarvisSubmit} className="relative">
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all"
              style={{
                backgroundColor: T.boxBg,
                borderColor: jarvisFocused ? T.accentColor : `${T.borderColor}30`,
                color: T.textMuted,
              }}
            >
              <Bot size={16} style={{ color: T.accentColor }} />
              <input
                value={aiQuery}
                onChange={(e) => setAiQuery(e.target.value)}
                onFocus={() => setJarvisFocused(true)}
                onBlur={() => setJarvisFocused(false)}
                placeholder="Ask Jarvis..."
                className="bg-transparent border-none outline-none flex-1 min-w-0 text-xs"
                style={{ color: T.textColor }}
              />
              <button type="submit" aria-label="Submit Jarvis query" className="p-1 rounded hover:bg-white/10" style={{ color: T.accentColor }}>
                <Send size={14} />
              </button>
            </div>
            {jarvisFocused && (
              <div
                className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg border shadow-xl p-2 space-y-1"
                style={{ backgroundColor: T.boxBg, borderColor: `${T.borderColor}30` }}
              >
                {AI_SUGGESTIONS.slice(0, 4).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onMouseDown={() => setAiQuery(s)}
                    className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-white/5 truncate"
                    style={{ color: T.textMuted }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </form>
        </div>
      )}

      {/* Personalize panel */}
      {showPersonalize && !collapsed && (
        <div
          className="px-3 py-3 border-b space-y-3"
          style={{ borderColor: `${T.borderColor}30`, backgroundColor: `${T.bgColor}60` }}
        >
          <div className="space-y-1.5">
            <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: T.textMuted }}>
              Mode
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {CREATOR_MODES.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setCreatorMode(m.value)}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded text-[10px] font-bold transition-colors"
                  style={{
                    backgroundColor: mode === m.value ? `${T.accentColor}20` : `${T.boxBg}60`,
                    color: mode === m.value ? T.accentColor : T.textMuted,
                    border: `1px solid ${mode === m.value ? T.accentColor : T.borderColor}30`,
                  }}
                >
                  <m.icon size={12} />
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: T.textMuted }}>
              Sections
            </div>
            <div className="flex flex-wrap gap-1">
              {NAV_GROUPS.map((g) => (
                <div
                  key={g.label}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold"
                  style={{
                    backgroundColor: hidden.includes(g.label) ? `${T.borderColor}20` : `${g.accent}20`,
                    border: `1px solid ${hidden.includes(g.label) ? T.borderColor : g.accent}40`,
                  }}
                >
                  <span style={{ color: hidden.includes(g.label) ? T.textMuted : g.accent }}>
                    {g.label}
                  </span>
                  <button
                    onClick={() => togglePin(g.label)}
                    className="p-0.5 rounded hover:bg-white/10"
                    title={pinned.includes(g.label) ? "Unpin" : "Pin to top"}
                    style={{ color: pinned.includes(g.label) ? g.accent : T.textMuted }}
                  >
                    <Pin size={10} style={{ fill: pinned.includes(g.label) ? g.accent : "none" }} />
                  </button>
                  <button
                    onClick={() => toggleHidden(g.label)}
                    className="p-0.5 rounded hover:bg-white/10"
                    title={hidden.includes(g.label) ? "Show" : "Hide"}
                    style={{ color: hidden.includes(g.label) ? g.accent : T.textMuted }}
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
      <div className="px-3 py-3 border-t" style={{ borderColor: `${T.borderColor}30` }}>
        {!collapsed && (
          <div className="space-y-1.5">
            <div
              className="flex items-center justify-between px-3 py-2 rounded-lg text-[10px] font-bold"
              style={{ backgroundColor: T.bgColor + "30", border: `1px solid ${T.borderColor}20` }}
            >
              <span className="flex items-center gap-1" style={{ color: "#fbbf24" }}>
                <Coins size={10} /> Balance
              </span>
              <span style={{ color: T.textColor }}>{balance.toLocaleString()} LBC</span>
            </div>
            <div
              className="flex items-center justify-between px-3 py-2 rounded-lg text-[10px] font-bold"
              style={{ backgroundColor: T.bgColor + "30", border: `1px solid ${T.borderColor}20` }}
            >
              <span className="flex items-center gap-1" style={{ color: T.accentColor }}>
                <CrownIcon size={10} /> Plan
              </span>
              <span style={{ color: T.textColor }}>{plan.charAt(0).toUpperCase() + plan.slice(1)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Sidebar({ open = false, onClose, collapsed: externalCollapsed }: SidebarProps) {
  const { resolvedColors: T } = useTheme();
  const [internalCollapsed, setInternalCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(COLLAPSED_KEY) === "true";
  });

  const collapsed = externalCollapsed ?? internalCollapsed;

  const toggleCollapse = useCallback(() => {
    setInternalCollapsed((v) => {
      const next = !v;
      if (typeof window !== "undefined") localStorage.setItem(COLLAPSED_KEY, String(next));
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
        <SidebarContent collapsed={collapsed} onToggleCollapse={toggleCollapse} />
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
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
