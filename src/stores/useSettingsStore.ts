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

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "overview", label: "Overview", description: "Settings hub summary", icon: "LayoutGrid", minMode: "standard" },
  { id: "account", label: "Account", description: "Profile and security", icon: "User", minMode: "standard" },
  { id: "appearance", label: "Appearance", description: "Theme, wallpaper, fonts", icon: "Palette", minMode: "standard" },
  { id: "living-ui", label: "Living UI", description: "Animations and effects", icon: "Sparkles", minMode: "standard" },
  { id: "pages", label: "Pages", description: "Per-page customization", icon: "Layers", minMode: "advanced" },
  { id: "navigation", label: "Navigation", description: "Sidebar and mobile tabs", icon: "Compass", minMode: "advanced" },
  { id: "workspace", label: "Workspace", description: "Layout and density", icon: "Briefcase", minMode: "advanced" },
  { id: "ai-models", label: "AI Models", description: "Model routing and credentials", icon: "Cpu", minMode: "pro" },
  { id: "agents", label: "Agents", description: "Agent configuration", icon: "Bot", minMode: "pro" },
  { id: "integrations", label: "Integrations", description: "Third-party connections", icon: "Plug", minMode: "pro" },
  { id: "connections", label: "Connections", description: "Service connections", icon: "Link", minMode: "pro" },
  { id: "voice", label: "Voice", description: "TTS and speech settings", icon: "Mic", minMode: "pro" },
  { id: "billing", label: "Billing", description: "Plan and usage", icon: "CreditCard", minMode: "standard" },
  { id: "notifications", label: "Notifications", description: "Alerts and digests", icon: "Bell", minMode: "standard" },
  { id: "privacy", label: "Privacy", description: "Data and visibility", icon: "Shield", minMode: "standard" },
  { id: "developer", label: "Developer", description: "Debug and API keys", icon: "Terminal", minMode: "owner", ownerOnly: true },
  { id: "danger", label: "Danger Zone", description: "Reset and delete", icon: "AlertTriangle", minMode: "owner", ownerOnly: true },
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
