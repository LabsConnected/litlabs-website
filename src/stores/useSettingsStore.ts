import { create } from "zustand";

export type ControlMode = "standard" | "advanced" | "pro";

export interface SettingsSection {
  id: string;
  label: string;
  description: string;
  icon: string;
  minMode: ControlMode;
}

export const MODE_ORDER: ControlMode[] = ["standard", "advanced", "pro"];

export const MODE_META: Record<ControlMode, { label: string; description: string; color: string }> = {
  standard: { label: "Standard", description: "Account, appearance, notifications, billing, privacy.", color: "#22c55e" },
  advanced: { label: "Advanced", description: "Page layouts, navigation, devices, performance, diagnostics.", color: "#3b82f6" },
  pro: { label: "Pro", description: "AI routing, agents, connections, automation, developer workflow.", color: "#a855f7" },
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
  // ── Standard: essential settings with safer defaults ──────────────
  { id: "overview", label: "Overview", description: "System status and quick actions", icon: "LayoutGrid", minMode: "standard" },
  { id: "account", label: "Account", description: "Profile, identity, and security", icon: "User", minMode: "standard" },
  { id: "appearance", label: "Appearance", description: "Theme, colors, fonts, effects", icon: "Palette", minMode: "standard" },
  { id: "workspace", label: "Workspace", description: "Studio layout and defaults", icon: "Briefcase", minMode: "standard" },
  { id: "notifications", label: "Notifications", description: "Alerts, email, quiet hours", icon: "Bell", minMode: "standard" },
  { id: "billing", label: "Billing & Credits", description: "Plan, usage, beta credits", icon: "Sparkles", minMode: "standard" },
  { id: "privacy", label: "Privacy & Security", description: "Sessions, data, audit log", icon: "Shield", minMode: "standard" },
  { id: "litt-knows", label: "What LiTT Knows", description: "Profile, memory, connections, consent", icon: "Bot", minMode: "standard" },

  // ── Advanced: page customization, navigation, devices ─────────────
  { id: "voice-camera", label: "Voice & Camera", description: "Microphone, camera, and voice", icon: "Mic", minMode: "advanced" },
  { id: "performance", label: "Performance", description: "Battery, effects, lazy loading", icon: "Gauge", minMode: "advanced" },
  { id: "advanced", label: "Advanced", description: "Diagnostics, debug, feature flags", icon: "Terminal", minMode: "advanced" },

  // ── Pro: AI routing, agents, integrations, automation ─────────────
  { id: "ai-models", label: "AI & Models", description: "Model routing and providers", icon: "Cpu", minMode: "pro" },
  { id: "agents", label: "LiTT & Spark", description: "Agent behavior and permissions", icon: "Bot", minMode: "pro" },
  { id: "connections", label: "Connections", description: "GitHub, Vercel, Supabase, AI keys", icon: "Plug", minMode: "pro" },
  { id: "automation", label: "Automation", description: "Triggers, schedules, retries", icon: "Zap", minMode: "pro" },
];

interface SettingsStore {
  controlMode: ControlMode;
  activeSection: string;
  searchQuery: string;
  hasUnsavedChanges: boolean;

  setControlMode: (mode: ControlMode) => void;
  setActiveSection: (section: string) => void;
  setSearchQuery: (q: string) => void;
  setUnsaved: (v: boolean) => void;
  visibleSections: () => SettingsSection[];
}

const CONTROL_MODE_STORAGE_KEY = "littree:settings:control-mode";

function loadControlMode(): ControlMode {
  if (typeof window === "undefined") return "standard";
  try {
    const stored = localStorage.getItem(CONTROL_MODE_STORAGE_KEY);
    if (stored === "standard" || stored === "advanced" || stored === "pro") return stored;
    return "standard";
  } catch {
    return "standard";
  }
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  controlMode: loadControlMode(),
  activeSection: "overview",
  searchQuery: "",
  hasUnsavedChanges: false,

  setControlMode: (controlMode) => {
    set({ controlMode });
    try {
      localStorage.setItem(CONTROL_MODE_STORAGE_KEY, controlMode);
    } catch {
      // Ignore storage errors.
    }
  },
  setActiveSection: (activeSection) => set({ activeSection }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setUnsaved: (hasUnsavedChanges) => set({ hasUnsavedChanges }),

  visibleSections: () => {
    const { controlMode, searchQuery } = get();
    const modeIdx = MODE_ORDER.indexOf(controlMode);
    return SETTINGS_SECTIONS.filter((s) => {
      const sIdx = MODE_ORDER.indexOf(s.minMode);
      if (sIdx > modeIdx) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return s.label.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
      }
      return true;
    });
  },
}));
