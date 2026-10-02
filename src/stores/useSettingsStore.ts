import { create } from "zustand";

export interface SettingsSection {
  id: string;
  label: string;
  description: string;
  icon: string;
  group: "app" | "capabilities" | "advanced";
}

export const SETTINGS_GROUPS = [
  { id: "app", label: "App Settings", description: "Core app preferences" },
  { id: "capabilities", label: "LiTT Capabilities", description: "What LiTT can do for you" },
  { id: "advanced", label: "Advanced", description: "Technical settings and diagnostics" },
] as const;

export const SETTINGS_SECTIONS: SettingsSection[] = [
  // App Settings
  { id: "overview", label: "Overview", description: "System status and quick actions", icon: "LayoutGrid", group: "app" },
  { id: "account", label: "Account", description: "Profile, identity, and security", icon: "User", group: "app" },
  { id: "appearance", label: "Appearance", description: "Theme, colors, fonts, effects", icon: "Palette", group: "app" },
  { id: "workspace", label: "Workspace", description: "Studio layout and defaults", icon: "Briefcase", group: "app" },
  { id: "billing", label: "Billing & Credits", description: "Plan, usage, beta credits", icon: "Sparkles", group: "app" },
  { id: "privacy", label: "Privacy & Data", description: "Sessions, data, audit log", icon: "Shield", group: "app" },
  { id: "voice-camera", label: "Voice & Camera", description: "Microphone, camera, and voice", icon: "Mic", group: "app" },
  { id: "performance", label: "Performance", description: "Battery, effects, lazy loading", icon: "Gauge", group: "app" },
  // LiTT Capabilities
  { id: "litt-knows", label: "What LiTT Knows", description: "Profile, memory, consent", icon: "Bot", group: "capabilities" },
  { id: "connections", label: "Connections", description: "GitHub, Vercel, Supabase, AI keys", icon: "Plug", group: "capabilities" },
  // Advanced
  { id: "ai-models", label: "AI & Models", description: "Model routing and providers (technical)", icon: "Cpu", group: "advanced" },
  { id: "advanced", label: "Diagnostics", description: "Diagnostics and debug", icon: "Terminal", group: "advanced" },
];

interface SettingsStore {
  activeSection: string;
  searchQuery: string;

  setActiveSection: (section: string) => void;
  setSearchQuery: (q: string) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  activeSection: "overview",
  searchQuery: "",

  setActiveSection: (activeSection) => set({ activeSection }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
}));
