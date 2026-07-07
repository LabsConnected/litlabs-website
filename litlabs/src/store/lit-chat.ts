// Global LiT chat store — survives route changes, always available
import { create } from "zustand";

export type LiTMessage = {
  id: string;
  role: "user" | "lit" | "system" | "tool";
  content: string;
  ts: number;
  meta?: {
    tool?: string;
    status?: "running" | "done" | "error";
    action?: { type: string; path?: string; command?: string };
    images?: Array<{ url: string; prompt: string; provider: string }>;
  };
};

type LiTState = {
  messages: LiTMessage[];
  isOpen: boolean;
  loading: boolean;
  route: string;
  // LiT-Tip
  tipScore: number | null;
  // Actions
  addMessage: (msg: LiTMessage) => void;
  updateMessage: (id: string, patch: Partial<LiTMessage>) => void;
  clearMessages: () => void;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setLoading: (loading: boolean) => void;
  setRoute: (route: string) => void;
  setTipScore: (score: number | null) => void;
};

export const useLitChat = create<LiTState>((set) => ({
  messages: [],
  isOpen: false,
  loading: false,
  route: "/",
  tipScore: null,

  addMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, msg] })),

  updateMessage: (id, patch) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),

  clearMessages: () => set({ messages: [] }),

  setOpen: (open) => set({ isOpen: open }),
  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  setLoading: (loading) => set({ loading }),
  setRoute: (route) => set({ route }),
  setTipScore: (score) => set({ tipScore: score }),
}));
