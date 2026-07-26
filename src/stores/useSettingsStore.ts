import { create } from "zustand";

export type ControlMode = "standard" | "advanced" | "pro" | "owner";

export interface SettingsSection {
  id: string;
  label: string;
  description: string;
  icon: string;
  minMode: ControlMode;
  ownerOnly?: boolean;
}

export const MODE_ORDER: ControlMode[] = ["standard", "advanced", "pro", "owner"];

export const MODE_META: Record<ControlMode, { label: string; description: string; color: string }> = {
  standard: { label: "Standard", description: "Essential settings with safer defaults.", color: "#22c55e" },
  advanced: { label: "Advanced", description: "More control over models, workspace, integrations, and automation.", color: "#3b82f6" },
  pro: { label: "Pro", description: "Developer and power-user controls.", color: "#a855f7" },
  owner: { label: "Owner", description: "Administrative and system-wide controls.", color: "#ef4444" },
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "overview", label: "Overview", description: "System status and quick actions", icon: "LayoutGrid", minMode: "standard" },
  { id: "account", label: "Account", description: "Profile, identity, and security", icon: "User", minMode: "standard" },
  { id: "appearance", label: "Appearance", description: "Theme, colors, fonts, effects", icon: "Palette", minMode: "standard" },
  { id: "workspace", label: "Workspace", description: "Studio layout and defaults", icon: "Briefcase", minMode: "standard" },
  { id: "ai-models", label: "AI & Models", description: "Model routing and providers", icon: "Cpu", minMode: "standard" },
  { id: "agents", label: "LiTT & Spark", description: "Agent behavior and permissions", icon: "Bot", minMode: "standard" },
  { id: "voice-camera", label: "Voice & Camera", description: "Microphone, camera, and voice", icon: "Mic", minMode: "standard" },
  { id: "connections", label: "Connections", description: "GitHub, Vercel, Supabase, AI keys", icon: "Plug", minMode: "standard" },
  { id: "automation", label: "Automation", description: "Triggers, schedules, retries", icon: "Zap", minMode: "advanced" },
  { id: "notifications", label: "Notifications", description: "Alerts, email, quiet hours", icon: "Bell", minMode: "standard" },
  { id: "billing", label: "Billing & LiTBits", description: "Plan, usage, beta credits", icon: "Coins", minMode: "standard" },
  { id: "privacy", label: "Privacy & Security", description: "Sessions, data, audit log", icon: "Shield", minMode: "standard" },
  { id: "performance", label: "Performance", description: "Battery, effects, lazy loading", icon: "Gauge", minMode: "standard" },
  { id: "advanced", label: "Advanced", description: "Diagnostics, debug, feature flags", icon: "Terminal", minMode: "advanced" },
  { id: "system", label: "System Control", description: "Owner-only platform controls", icon: "Server", minMode: "owner", ownerOnly: true },
];

interface SettingsStore {
  controlMode: ControlMode;
  activeSection: string;
  searchQuery: string;
  hasUnsavedChanges: boolean;
  isOwner: boolean;
  isAdmin: boolean;

  setControlMode: (mode: ControlMode) => void;
  setActiveSection: (section: string) => void;
  setSearchQuery: (q: string) => void;
  setUnsaved: (v: boolean) => void;
  setOwner: (v: boolean) => void;
  visibleSections: () => SettingsSection[];
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  controlMode: "standard",
  activeSection: "overview",
  searchQuery: "",
  hasUnsavedChanges: false,
  isOwner: false,
  isAdmin: false,

  setControlMode: (controlMode) => set({ controlMode }),
  setActiveSection: (activeSection) => set({ activeSection }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setUnsaved: (hasUnsavedChanges) => set({ hasUnsavedChanges }),
  setOwner: (isOwner) => set({ isOwner, isAdmin: isOwner }),

  visibleSections: () => {
    const { controlMode, searchQuery, isOwner } = get();
    const modeIdx = MODE_ORDER.indexOf(controlMode);
    return SETTINGS_SECTIONS.filter((s) => {
      const sIdx = MODE_ORDER.indexOf(s.minMode);
      if (sIdx > modeIdx) return false;
      if (s.ownerOnly && !isOwner) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return s.label.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
      }
      return true;
    });
  },
}));
