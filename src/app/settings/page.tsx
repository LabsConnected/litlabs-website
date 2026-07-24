"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  LayoutGrid, User, Palette, Sparkles, Layers, Compass, Briefcase,
  Cpu, Bot, Mic, Plug, Zap, Bell, Coins, Shield, Gauge, Terminal,
  Server, Search, ChevronRight, Check, Loader2, AlertCircle,
  RotateCcw, Lock, X,
} from "lucide-react";
import {
  useSettingsStore,
  SETTINGS_SECTIONS,
  MODE_ORDER,
  type ControlMode,
  type SettingsSection,
} from "@/stores/useSettingsStore";
import {
  SettingsCard,
  SectionHeader,
  ToggleRow,
  SettingsInput,
  SaveBar,
  StatusBadge,
  type SaveStatus,
} from "@/components/settings/SettingsPrimitives";
import { VisualPackSettings } from "@/components/settings/VisualPackSettings";

/* ── Icon map ──────────────────────────────────────────────────────── */

const ICONS: Record<string, React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>> = {
  LayoutGrid, User, Palette, Sparkles, Layers, Compass, Briefcase,
  Cpu, Bot, Mic, Plug, Zap, Bell, Coins, Shield, Gauge, Terminal, Server,
};

/* ── Mode metadata ─────────────────────────────────────────────────── */

const MODE_META: Record<ControlMode, { label: string; description: string; color: string }> = {
  standard: { label: "Standard", description: "Safe global preferences", color: "#22c55e" },
  advanced: { label: "Advanced", description: "Per-page and navigation control", color: "#3b82f6" },
  pro: { label: "Pro", description: "AI, agents, workflows, integrations", color: "#a855f7" },
  owner: { label: "Owner", description: "Full platform administration", color: "#ef4444" },
};

/* ── Scope selector ────────────────────────────────────────────────── */

const APPLY_SCOPES = [
  { id: "global", label: "Entire LiTTree" },
  { id: "page", label: "Current page" },
  { id: "selected", label: "Selected pages" },
] as const;

/* ── Main page ─────────────────────────────────────────────────────── */

export default function SettingsPage() {
  const { resolvedColors: T } = useTheme();
  const {
    controlMode, activeSection, searchQuery, hasUnsavedChanges,
    isOwner, isAdmin, setControlMode, setActiveSection, setSearchQuery,
    setUnsaved, setOwner, visibleSections,
  } = useSettingsStore();

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const sections = visibleSections();

  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return sections;
    const q = searchQuery.toLowerCase();
    return sections.filter(
      (s) => s.label.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  }, [sections, searchQuery]);

  const activeSectionMeta = useMemo(
    () => SETTINGS_SECTIONS.find((s) => s.id === activeSection),
    [activeSection],
  );

  const handleSave = useCallback(() => {
    setSaveStatus("saving");
    setTimeout(() => {
      setSaveStatus("saved");
      setUnsaved(false);
      setTimeout(() => setSaveStatus("idle"), 2000);
    }, 800);
  }, [setUnsaved]);

  const handleDiscard = useCallback(() => {
    setUnsaved(false);
    setSaveStatus("idle");
  }, [setUnsaved]);

  const handleSectionClick = useCallback((sectionId: string) => {
    setActiveSection(sectionId);
    setMobileNavOpen(false);
  }, [setActiveSection]);

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: T.bgColor + "d0", color: T.textColor }}
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-0 lg:flex-row">
        {/* ── Sidebar navigation ─────────────────────────────────── */}
        <aside
          className="sticky top-0 z-30 hidden h-screen w-72 shrink-0 border-r lg:block"
          style={{
            borderColor: "rgba(255,255,255,0.06)",
            backgroundColor: "rgba(10,12,18,0.6)",
            backdropFilter: "blur(20px)",
          }}
        >
          <SettingsNav
            sections={filteredSections}
            activeSection={activeSection}
            onSectionClick={handleSectionClick}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            controlMode={controlMode}
            onModeChange={setControlMode}
            isOwner={isOwner}
            T={T}
          />
        </aside>

        {/* Mobile nav toggle */}
        <div className="sticky top-0 z-40 flex items-center justify-between border-b px-4 py-3 lg:hidden"
          style={{
            backgroundColor: "rgba(10,12,18,0.9)",
            borderColor: "rgba(255,255,255,0.06)",
            backdropFilter: "blur(14px)",
          }}
        >
          <span className="text-sm font-black" style={{ color: "rgba(255,255,255,0.9)" }}>
            Settings
          </span>
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-lg border"
            style={{ borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)" }}
            aria-label="Open settings navigation"
          >
            <Layers size={16} className="pointer-events-none" />
          </button>
        </div>

        {/* Mobile nav drawer */}
        {mobileNavOpen && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 bg-black/60 lg:hidden"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close navigation"
            />
            <div
              className="fixed left-0 top-0 z-50 h-full w-80 max-w-[85vw] overflow-y-auto border-r lg:hidden"
              style={{
                backgroundColor: "rgba(10,12,18,0.98)",
                borderColor: "rgba(255,255,255,0.06)",
                backdropFilter: "blur(20px)",
              }}
            >
              <div className="flex items-center justify-between border-b px-4 py-3"
                style={{ borderColor: "rgba(255,255,255,0.06)" }}
              >
                <span className="text-sm font-black" style={{ color: "rgba(255,255,255,0.9)" }}>
                  Settings
                </span>
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(false)}
                  className="grid h-9 w-9 place-items-center rounded-lg hover:bg-white/10"
                  aria-label="Close navigation"
                >
                  <X size={16} className="pointer-events-none" />
                </button>
              </div>
              <SettingsNav
                sections={filteredSections}
                activeSection={activeSection}
                onSectionClick={handleSectionClick}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                controlMode={controlMode}
                onModeChange={setControlMode}
                isOwner={isOwner}
                T={T}
              />
            </div>
          </>
        )}

        {/* ── Main content ──────────────────────────────────────── */}
        <main className="min-w-0 flex-1 px-4 py-6 pb-24 lg:px-8 lg:py-8">
          {activeSectionMeta && (
            <>
              <SectionHeader
                title={activeSectionMeta.label}
                description={activeSectionMeta.description}
              />
              <SettingsContent section={activeSectionMeta.id} T={T} controlMode={controlMode} isOwner={isOwner} />
            </>
          )}
        </main>
      </div>

      {/* ── Sticky save bar ──────────────────────────────────────── */}
      <SaveBar
        status={saveStatus}
        onSave={handleSave}
        onDiscard={handleDiscard}
        hasChanges={hasUnsavedChanges}
      />
    </div>
  );
}

/* ── Settings navigation ───────────────────────────────────────────── */

function SettingsNav({
  sections,
  activeSection,
  onSectionClick,
  searchQuery,
  onSearchChange,
  controlMode,
  onModeChange,
  isOwner,
  T,
}: {
  sections: SettingsSection[];
  activeSection: string;
  onSectionClick: (id: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  controlMode: ControlMode;
  onModeChange: (m: ControlMode) => void;
  isOwner: boolean;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  return (
    <div className="flex h-full flex-col">
      {/* Search */}
      <div className="border-b px-4 py-3" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search settings…"
            className="w-full rounded-xl border py-2.5 pl-9 pr-3 text-sm outline-none transition-all focus:ring-2"
            style={{
              backgroundColor: "rgba(10,12,18,0.6)",
              borderColor: "rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.88)",
            }}
          />
        </div>
      </div>

      {/* Control mode selector */}
      <div className="border-b px-4 py-3" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <div className="mb-2 text-[9px] font-black uppercase tracking-[0.15em] text-white/40">
          Control Mode
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {MODE_ORDER.map((mode) => {
            const meta = MODE_META[mode];
            const isActive = controlMode === mode;
            const isLocked = mode === "owner" && !isOwner;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => !isLocked && onModeChange(mode)}
                disabled={isLocked}
                className="flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[10px] font-bold transition-all disabled:cursor-not-allowed disabled:opacity-30"
                style={{
                  backgroundColor: isActive ? `${meta.color}15` : "transparent",
                  borderColor: isActive ? `${meta.color}40` : "rgba(255,255,255,0.06)",
                  color: isActive ? meta.color : "rgba(255,255,255,0.5)",
                }}
                aria-label={`${meta.label} mode`}
              >
                {isLocked ? (
                  <Lock size={10} className="pointer-events-none" />
                ) : (
                  <span
                    className="pointer-events-none h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: meta.color }}
                  />
                )}
                {meta.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[9px] text-white/30">
          {MODE_META[controlMode].description}
        </p>
      </div>

      {/* Section list */}
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {sections.map((section) => {
          const Icon = ICONS[section.icon] ?? LayoutGrid;
          const isActive = activeSection === section.id;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onSectionClick(section.id)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all hover:bg-white/5"
              style={{
                backgroundColor: isActive ? `${T.accentColor}10` : "transparent",
              }}
            >
              <span
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
                style={{
                  backgroundColor: isActive ? `${T.accentColor}15` : "rgba(255,255,255,0.04)",
                  color: isActive ? T.accentColor : "rgba(255,255,255,0.4)",
                }}
              >
                <Icon size={14} className="pointer-events-none" />
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className="text-xs font-bold"
                  style={{ color: isActive ? T.accentColor : "rgba(255,255,255,0.7)" }}
                >
                  {section.label}
                </div>
                <div className="truncate text-[9px] text-white/35">
                  {section.description}
                </div>
              </div>
              <ChevronRight size={12} className="pointer-events-none text-white/20" />
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/* ── Section content router ────────────────────────────────────────── */

function SettingsContent({
  section,
  T,
  controlMode,
  isOwner,
}: {
  section: string;
  T: ReturnType<typeof useTheme>["resolvedColors"];
  controlMode: ControlMode;
  isOwner: boolean;
}) {
  switch (section) {
    case "overview":
      return <OverviewSection T={T} controlMode={controlMode} />;
    case "account":
      return <AccountSection T={T} />;
    case "appearance":
      return <AppearanceSection T={T} />;
    case "living-ui":
      return <LivingUISection T={T} />;
    case "pages":
      return <PagesSection T={T} />;
    case "navigation":
      return <NavigationSection T={T} />;
    case "workspace":
      return <WorkspaceSection T={T} />;
    case "ai-models":
      return <AIModelsSection T={T} />;
    case "agents":
      return <AgentsSection T={T} />;
    case "voice-camera":
      return <VoiceCameraSection T={T} />;
    case "connections":
      return <ConnectionsSection T={T} />;
    case "automation":
      return <AutomationSection T={T} />;
    case "notifications":
      return <NotificationsSection T={T} />;
    case "billing":
      return <BillingSection T={T} />;
    case "privacy":
      return <PrivacySection T={T} />;
    case "performance":
      return <PerformanceSection T={T} />;
    case "advanced":
      return <AdvancedSection T={T} />;
    case "system":
      return isOwner ? <SystemControlSection T={T} /> : <LockedSection T={T} label="System Control" />;
    default:
      return null;
  }
}

/* ── Overview ──────────────────────────────────────────────────────── */

function OverviewSection({ T, controlMode }: { T: ReturnType<typeof useTheme>["resolvedColors"]; controlMode: ControlMode }) {
  const visibleCount = SETTINGS_SECTIONS.filter((s) => {
    const modeIdx = MODE_ORDER.indexOf(s.minMode);
    const curIdx = MODE_ORDER.indexOf(controlMode);
    return modeIdx <= curIdx && (!s.ownerOnly || true);
  }).length;

  return (
    <div className="space-y-4">
      <SettingsCard title="Welcome" description="Your settings hub" icon={<LayoutGrid size={16} />}>
        <p className="text-sm text-white/60">
          You are currently in <span className="font-bold" style={{ color: MODE_META[controlMode].color }}>{MODE_META[controlMode].label}</span> mode.
          {visibleCount} sections are visible. Switch modes to reveal more controls.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {MODE_ORDER.map((mode) => {
            const meta = MODE_META[mode];
            return (
              <StatusBadge
                key={mode}
                label={meta.label}
                color={controlMode === mode ? meta.color : "rgba(255,255,255,0.2)"}
              />
            );
          })}
        </div>
      </SettingsCard>

      <SettingsCard title="Quick actions" description="Common settings">
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { label: "Change theme", section: "appearance" },
            { label: "Manage connections", section: "connections" },
            { label: "AI model routing", section: "ai-models" },
            { label: "Notifications", section: "notifications" },
          ].map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => useSettingsStore.getState().setActiveSection(action.section)}
              className="flex items-center justify-between rounded-xl border px-3 py-2.5 text-xs font-bold transition-all hover:bg-white/5"
              style={{
                borderColor: "rgba(255,255,255,0.06)",
                color: "rgba(255,255,255,0.7)",
              }}
            >
              {action.label}
              <ChevronRight size={12} className="pointer-events-none text-white/30" />
            </button>
          ))}
        </div>
      </SettingsCard>
    </div>
  );
}

/* ── Account ──────────────────────────────────────────────────────── */

function AccountSection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  return (
    <div className="space-y-4">
      <SettingsCard title="Profile" description="Your account information" icon={<User size={16} />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <SettingsInput label="Display name" value="" onChange={() => {}} placeholder="Your name" />
          <SettingsInput label="Email" value="" onChange={() => {}} placeholder="you@example.com" type="email" />
        </div>
      </SettingsCard>
      <SettingsCard title="Security" description="Password and authentication">
        <div className="space-y-3">
          <ToggleRow
            icon={<Shield size={14} />}
            title="Two-factor authentication"
            description="Add an extra layer of security"
            checked={false}
            onChange={() => {}}
          />
          <ToggleRow
            icon={<Lock size={14} />}
            title="Require reauthentication"
            description="For sensitive actions"
            checked={false}
            onChange={() => {}}
          />
        </div>
      </SettingsCard>
    </div>
  );
}

/* ── Appearance ────────────────────────────────────────────────────── */

function AppearanceSection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  return (
    <div className="space-y-4">
      <SettingsCard title="Visual Pack" description="Theme, wallpaper, fonts, effects" icon={<Palette size={16} />}>
        <VisualPackSettings />
      </SettingsCard>
    </div>
  );
}

/* ── Living UI ─────────────────────────────────────────────────────── */

function LivingUISection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  return (
    <div className="space-y-4">
      <SettingsCard title="Animations" description="Motion and particle effects" icon={<Sparkles size={16} />}>
        <div className="space-y-3">
          <ToggleRow
            icon={<Sparkles size={14} />}
            title="Animated background"
            description="Living wallpaper particles"
            checked={true}
            onChange={() => {}}
          />
          <ToggleRow
            icon={<Zap size={14} />}
            title="Reduced motion"
            description="Minimize animations"
            checked={false}
            onChange={() => {}}
          />
        </div>
      </SettingsCard>
    </div>
  );
}

/* ── Pages ─────────────────────────────────────────────────────────── */

function PagesSection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  const pages = ["dashboard", "studio", "agents", "gallery", "games", "social", "marketplace", "settings"];
  return (
    <div className="space-y-4">
      <SettingsCard title="Per-page customization" description="Override global settings for specific pages" icon={<Layers size={16} />}>
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-blue-400/20 bg-blue-400/5 px-3 py-2.5">
          <span className="text-[10px] font-bold text-blue-300">Apply to:</span>
          {APPLY_SCOPES.map((scope) => (
            <label key={scope.id} className="flex items-center gap-1.5 text-[10px] text-white/60">
              <input type="radio" name="apply-scope" defaultChecked={scope.id === "global"} className="accent-blue-400" />
              {scope.label}
            </label>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {pages.map((page) => (
            <button
              key={page}
              type="button"
              className="flex items-center justify-between rounded-xl border px-3 py-2.5 text-xs font-bold capitalize transition-all hover:bg-white/5"
              style={{ borderColor: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)" }}
            >
              {page}
              <span className="text-[9px] text-white/30">Customize →</span>
            </button>
          ))}
        </div>
      </SettingsCard>
    </div>
  );
}

/* ── Navigation ────────────────────────────────────────────────────── */

function NavigationSection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  return (
    <div className="space-y-4">
      <SettingsCard title="Navigation ordering" description="Reorder sidebar and mobile tabs" icon={<Compass size={16} />}>
        <p className="text-xs text-white/40">Drag to reorder navigation items. Changes apply to desktop sidebar and mobile bottom nav.</p>
      </SettingsCard>
      <SettingsCard title="Mobile navigation" description="Choose which tabs appear on mobile">
        <div className="space-y-2">
          {["Dashboard", "Studio", "Agents", "Gallery", "Games", "Social"].map((tab) => (
            <ToggleRow key={tab} title={tab} checked={true} onChange={() => {}} />
          ))}
        </div>
      </SettingsCard>
    </div>
  );
}

/* ── Workspace ─────────────────────────────────────────────────────── */

function WorkspaceSection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  return (
    <div className="space-y-4">
      <SettingsCard title="Layout" description="Density, overlays, blur" icon={<Briefcase size={16} />}>
        <div className="space-y-3">
          <ToggleRow title="Compact density" description="Reduce padding and spacing" checked={false} onChange={() => {}} />
          <ToggleRow title="Overlay effects" description="Blur and transparency" checked={true} onChange={() => {}} />
          <ToggleRow title="Parallax scrolling" description="Depth effect on scroll" checked={false} onChange={() => {}} />
        </div>
      </SettingsCard>
    </div>
  );
}

/* ── AI & Models ───────────────────────────────────────────────────── */

function AIModelsSection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  return (
    <div className="space-y-4">
      <SettingsCard title="Model routing" description="Task-specific model assignment" icon={<Cpu size={16} />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <SettingsInput label="Default chat model" value="gemini-2.5-flash" onChange={() => {}} />
          <SettingsInput label="Code generation model" value="claude-sonnet-4" onChange={() => {}} />
          <SettingsInput label="Image generation model" value="fal/flux" onChange={() => {}} />
          <SettingsInput label="Embedding model" value="text-embedding-3-small" onChange={() => {}} />
        </div>
      </SettingsCard>
      <SettingsCard title="Provider credentials" description="API keys for AI providers">
        <div className="space-y-2">
          {["OpenRouter", "Google Gemini", "Together AI", "Fal.ai", "MiniMax"].map((provider) => (
            <ToggleRow
              key={provider}
              title={provider}
              description="API key configured"
              checked={false}
              onChange={() => {}}
              onConfigure={() => {}}
              configureLabel="Add key"
            />
          ))}
        </div>
      </SettingsCard>
      <SettingsCard title="Spending limits" description="Control AI costs">
        <div className="grid gap-4 sm:grid-cols-2">
          <SettingsInput label="Daily spend limit ($)" value="5" onChange={() => {}} type="number" />
          <SettingsInput label="Monthly spend limit ($)" value="50" onChange={() => {}} type="number" />
        </div>
      </SettingsCard>
    </div>
  );
}

/* ── Agents ────────────────────────────────────────────────────────── */

function AgentsSection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  return (
    <div className="space-y-4">
      <SettingsCard title="Agent permissions" description="Control what agents can do" icon={<Bot size={16} />}>
        <div className="space-y-3">
          <ToggleRow title="Terminal execution" description="Allow agents to run commands" checked={true} onChange={() => {}} />
          <ToggleRow title="File write access" description="Allow agents to modify files" checked={false} onChange={() => {}} />
          <ToggleRow title="GitHub access" description="Allow agents to push and create PRs" checked={false} onChange={() => {}} />
          <ToggleRow title="Deployment approval" description="Require approval before deploying" checked={true} onChange={() => {}} />
        </div>
      </SettingsCard>
    </div>
  );
}

/* ── Voice & Camera ────────────────────────────────────────────────── */

function VoiceCameraSection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  return (
    <div className="space-y-4">
      <SettingsCard title="Voice" description="Voice profiles and speech" icon={<Mic size={16} />}>
        <div className="space-y-3">
          <ToggleRow title="Voice input" description="Enable microphone for chat" checked={true} onChange={() => {}} />
          <ToggleRow title="Auto-speak responses" description="Read AI responses aloud" checked={false} onChange={() => {}} />
        </div>
      </SettingsCard>
      <SettingsCard title="Camera" description="Camera access for visual tools">
        <ToggleRow title="Camera access" description="Allow camera for visual agent" checked={false} onChange={() => {}} />
      </SettingsCard>
    </div>
  );
}

/* ── Connections ───────────────────────────────────────────────────── */

function ConnectionsSection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  return (
    <div className="space-y-4">
      <SettingsCard title="Integrations" description="Connected services" icon={<Plug size={16} />}>
        <div className="space-y-2">
          {["GitHub", "Meta/Facebook", "Stripe", "Supabase", "Cloudflare R2"].map((service) => (
            <ToggleRow
              key={service}
              title={service}
              checked={false}
              onChange={() => {}}
              onConfigure={() => {}}
              configureLabel="Connect"
            />
          ))}
        </div>
      </SettingsCard>
      <SettingsCard title="Webhooks" description="Incoming and outgoing webhooks">
        <p className="text-xs text-white/40">Configure webhook endpoints for automation triggers.</p>
      </SettingsCard>
    </div>
  );
}

/* ── Automation ────────────────────────────────────────────────────── */

function AutomationSection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  return (
    <div className="space-y-4">
      <SettingsCard title="Workflow automation" description="Auto-run rules and triggers" icon={<Zap size={16} />}>
        <div className="space-y-3">
          <ToggleRow title="Auto-run tests" description="Run tests on file changes" checked={false} onChange={() => {}} />
          <ToggleRow title="Auto-open preview" description="Open preview after build" checked={true} onChange={() => {}} />
          <ToggleRow title="Auto-save" description="Save changes automatically" checked={true} onChange={() => {}} />
        </div>
      </SettingsCard>
      <SettingsCard title="Failure recovery" description="What happens when things go wrong">
        <ToggleRow title="Auto-retry on failure" description="Retry failed operations" checked={true} onChange={() => {}} />
      </SettingsCard>
    </div>
  );
}

/* ── Notifications ─────────────────────────────────────────────────── */

function NotificationsSection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  return (
    <div className="space-y-4">
      <SettingsCard title="Alerts" description="What you get notified about" icon={<Bell size={16} />}>
        <div className="space-y-3">
          <ToggleRow title="Build complete" description="When a build finishes" checked={true} onChange={() => {}} />
          <ToggleRow title="Deployment status" description="When a deployment succeeds or fails" checked={true} onChange={() => {}} />
          <ToggleRow title="Agent messages" description="When an agent sends a message" checked={false} onChange={() => {}} />
          <ToggleRow title="Mention notifications" description="When you're mentioned" checked={true} onChange={() => {}} />
        </div>
      </SettingsCard>
      <SettingsCard title="Quiet hours" description="Mute notifications during specific times">
        <div className="grid gap-4 sm:grid-cols-2">
          <SettingsInput label="Start" value="22:00" onChange={() => {}} type="time" />
          <SettingsInput label="End" value="08:00" onChange={() => {}} type="time" />
        </div>
      </SettingsCard>
    </div>
  );
}

/* ── Billing ──────────────────────────────────────────────────────── */

function BillingSection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  return (
    <div className="space-y-4">
      <SettingsCard title="Plan" description="Your current subscription" icon={<Coins size={16} />}>
        <div className="flex items-center justify-between rounded-xl border px-4 py-3"
          style={{ borderColor: `${T.accentColor}30`, backgroundColor: `${T.accentColor}08` }}
        >
          <div>
            <div className="text-sm font-black" style={{ color: T.accentColor }}>Free Plan</div>
            <div className="text-[10px] text-white/40">Upgrade for more features</div>
          </div>
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-xs font-bold transition-all hover:opacity-90"
            style={{ backgroundColor: T.accentColor, color: "#000" }}
          >
            Upgrade
          </button>
        </div>
      </SettingsCard>
      <SettingsCard title="LiTBits" description="Your virtual currency balance">
        <div className="text-2xl font-black" style={{ color: T.accentColor }}>0 LiTBits</div>
        <p className="mt-1 text-xs text-white/40">Earn LiTBits by contributing and completing missions.</p>
      </SettingsCard>
    </div>
  );
}

/* ── Privacy ──────────────────────────────────────────────────────── */

function PrivacySection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  return (
    <div className="space-y-4">
      <SettingsCard title="Data privacy" description="Control your data" icon={<Shield size={16} />}>
        <div className="space-y-3">
          <ToggleRow title="Analytics opt-in" description="Share usage data to improve LiTTree" checked={false} onChange={() => {}} />
          <ToggleRow title="Public profile" description="Make your profile visible to others" checked={true} onChange={() => {}} />
        </div>
      </SettingsCard>
      <SettingsCard title="Sessions" description="Active login sessions">
        <p className="text-xs text-white/40">Manage your active sessions across devices.</p>
      </SettingsCard>
    </div>
  );
}

/* ── Performance ───────────────────────────────────────────────────── */

function PerformanceSection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  return (
    <div className="space-y-4">
      <SettingsCard title="Rendering" description="Optimize performance" icon={<Gauge size={16} />}>
        <div className="space-y-3">
          <ToggleRow title="Performance mode" description="Reduce effects for speed" checked={false} onChange={() => {}} />
          <ToggleRow title="Cache assets" description="Cache static resources" checked={true} onChange={() => {}} />
          <ToggleRow title="Lazy load images" description="Defer offscreen images" checked={true} onChange={() => {}} />
        </div>
      </SettingsCard>
    </div>
  );
}

/* ── Advanced ──────────────────────────────────────────────────────── */

function AdvancedSection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  return (
    <div className="space-y-4">
      <SettingsCard title="Developer options" description="Advanced overrides" icon={<Terminal size={16} />}>
        <div className="space-y-3">
          <ToggleRow title="Debug mode" description="Show debug information" checked={false} onChange={() => {}} />
          <ToggleRow title="Verbose logging" description="Detailed console output" checked={false} onChange={() => {}} />
        </div>
      </SettingsCard>
      <SettingsCard title="Overrides" description="Desktop and mobile overrides">
        <p className="text-xs text-white/40">Set different preferences for desktop and mobile devices.</p>
      </SettingsCard>
      <SettingsCard title="Reset" description="Reset all settings">
        <div className="flex flex-wrap gap-2">
          {[
            { label: "Reset current section", scope: "section" },
            { label: "Reset current page", scope: "page" },
            { label: "Reset all settings", scope: "all" },
          ].map((reset) => (
            <button
              key={reset.scope}
              type="button"
              className="flex items-center gap-1.5 rounded-lg border border-red-400/20 px-3 py-1.5 text-xs font-bold text-red-300 transition-all hover:bg-red-400/10"
            >
              <RotateCcw size={12} className="pointer-events-none" />
              {reset.label}
            </button>
          ))}
        </div>
      </SettingsCard>
    </div>
  );
}

/* ── System Control (owner only) ───────────────────────────────────── */

function SystemControlSection({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  return (
    <div className="space-y-4">
      <div
        className="rounded-2xl border p-4"
        style={{ borderColor: "#ef444430", backgroundColor: "#ef444408" }}
      >
        <div className="flex items-center gap-2">
          <Server size={16} className="text-red-400" />
          <span className="text-sm font-black text-red-400">System Control</span>
        </div>
        <p className="mt-1 text-xs text-white/50">
          These controls affect the entire platform. Changes are audit-logged.
        </p>
      </div>

      <SettingsCard title="Feature flags" description="Enable or disable platform features" icon={<Server size={16} />}>
        <div className="space-y-3">
          <ToggleRow title="Maintenance mode" description="Take the platform offline" checked={false} onChange={() => {}} />
          <ToggleRow title="New user registration" description="Allow new signups" checked={true} onChange={() => {}} />
          <ToggleRow title="Marketplace" description="Enable marketplace" checked={true} onChange={() => {}} />
        </div>
      </SettingsCard>

      <SettingsCard title="User management" description="Roles and permissions">
        <div className="space-y-2">
          {["User roles", "User suspension", "Balance adjustments"].map((action) => (
            <button
              key={action}
              type="button"
              className="flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-xs font-bold transition-all hover:bg-white/5"
              style={{ borderColor: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)" }}
            >
              {action}
              <ChevronRight size={12} className="pointer-events-none text-white/30" />
            </button>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="Infrastructure" description="Workers, queues, cache">
        <div className="space-y-2">
          {["Worker status", "Queue status", "Cache controls", "Database tools"].map((item) => (
            <button
              key={item}
              type="button"
              className="flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-xs font-bold transition-all hover:bg-white/5"
              style={{ borderColor: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)" }}
            >
              {item}
              <ChevronRight size={12} className="pointer-events-none text-white/30" />
            </button>
          ))}
        </div>
      </SettingsCard>
    </div>
  );
}

/* ── Locked section ────────────────────────────────────────────────── */

function LockedSection({ T, label }: { T: ReturnType<typeof useTheme>["resolvedColors"]; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <Lock size={32} className="text-white/20" />
      <p className="mt-4 text-sm font-bold text-white/40">{label} is locked</p>
      <p className="mt-1 text-xs text-white/25">Owner verification required to access this section.</p>
    </div>
  );
}
