import { create } from "zustand";

export interface SettingsSection {
  id: string;
  label: string;
  description: string;
  icon: string;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "overview", label: "Overview", description: "System status and quick actions", icon: "LayoutGrid" },
  { id: "account", label: "Account", description: "Profile, identity, and security", icon: "User" },
  { id: "appearance", label: "Appearance", description: "Theme, colors, fonts, effects", icon: "Palette" },
  { id: "workspace", label: "Workspace", description: "Studio layout and defaults", icon: "Briefcase" },
  { id: "billing", label: "Billing & Credits", description: "Plan, usage, beta credits", icon: "Sparkles" },
  { id: "privacy", label: "Privacy & Security", description: "Sessions, data, audit log", icon: "Shield" },
  { id: "litt-knows", label: "What LiTT Knows", description: "Profile, memory, connections, consent", icon: "Bot" },
  { id: "voice-camera", label: "Voice & Camera", description: "Microphone, camera, and voice", icon: "Mic" },
  { id: "performance", label: "Performance", description: "Battery, effects, lazy loading", icon: "Gauge" },
  { id: "advanced", label: "Advanced", description: "Diagnostics and debug", icon: "Terminal" },
  { id: "ai-models", label: "AI & Models", description: "Model routing and providers", icon: "Cpu" },
  { id: "connections", label: "Connections", description: "GitHub, Vercel, Supabase, AI keys", icon: "Plug" },
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
