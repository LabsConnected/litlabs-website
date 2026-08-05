/**
 * Studio Shell Store — Global UI state for the Infinite Studio.
 *
 * Controls panel visibility, sizes, active modes, and focus mode.
 * Panel sizes are persisted to localStorage.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type StudioMode = "canvas" | "code" | "chat" | "preview" | "workflow" | "media";
export type BottomDockTab = "chat" | "terminal" | "console" | "problems" | "tests" | "deploy" | "music";
export type LeftRailTab = "projects" | "files" | "assets" | "memory" | "agents" | "deploy";
export type LiTTStatus = "ready" | "working" | "error" | "needs-attention";

interface StudioState {
  // Panel visibility
  leftRailOpen: boolean;
  rightPanelOpen: boolean;
  bottomDockOpen: boolean;
  commandBarOpen: boolean;
  focusMode: boolean;

  // Active selections
  activeMode: StudioMode;
  activeLeftRailTab: LeftRailTab;
  activeBottomDockTab: BottomDockTab;
  littStatus: LiTTStatus;

  // Panel sizes (percentages, persisted)
  leftRailSize: number;
  rightPanelSize: number;
  bottomDockSize: number;

  // Actions
  toggleLeftRail: () => void;
  toggleRightPanel: () => void;
  toggleBottomDock: () => void;
  toggleCommandBar: () => void;
  toggleFocusMode: () => void;
  setMode: (mode: StudioMode) => void;
  setLeftRailTab: (tab: LeftRailTab) => void;
  setBottomDockTab: (tab: BottomDockTab) => void;
  setLiTTStatus: (status: LiTTStatus) => void;
  setLeftRailSize: (size: number) => void;
  setRightPanelSize: (size: number) => void;
  setBottomDockSize: (size: number) => void;
  setCommandBarOpen: (open: boolean) => void;
}

export const useStudioStore = create<StudioState>()(
  persist(
    (set) => ({
      leftRailOpen: true,
      rightPanelOpen: true,
      bottomDockOpen: false,
      commandBarOpen: false,
      focusMode: false,

      activeMode: "canvas",
      activeLeftRailTab: "projects",
      activeBottomDockTab: "chat",
      littStatus: "ready",

      leftRailSize: 18,
      rightPanelSize: 22,
      bottomDockSize: 25,

      toggleLeftRail: () => set((s) => ({ leftRailOpen: !s.leftRailOpen })),
      toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
      toggleBottomDock: () => set((s) => ({ bottomDockOpen: !s.bottomDockOpen })),
      toggleCommandBar: () => set((s) => ({ commandBarOpen: !s.commandBarOpen })),
      toggleFocusMode: () => set((s) => ({
        focusMode: !s.focusMode,
        leftRailOpen: s.focusMode,
        rightPanelOpen: s.focusMode,
        bottomDockOpen: false,
      })),
      setMode: (mode) => set({ activeMode: mode }),
      setLeftRailTab: (tab) => set({ activeLeftRailTab: tab, leftRailOpen: true }),
      setBottomDockTab: (tab) => set({ activeBottomDockTab: tab, bottomDockOpen: true }),
      setLiTTStatus: (status) => set({ littStatus: status }),
      setLeftRailSize: (size) => set({ leftRailSize: size }),
      setRightPanelSize: (size) => set({ rightPanelSize: size }),
      setBottomDockSize: (size) => set({ bottomDockSize: size }),
      setCommandBarOpen: (open) => set({ commandBarOpen: open }),
    }),
    {
      name: "litt-studio-shell",
      partialize: (state) => ({
        leftRailOpen: state.leftRailOpen,
        rightPanelOpen: state.rightPanelOpen,
        bottomDockOpen: state.bottomDockOpen,
        activeMode: state.activeMode,
        activeLeftRailTab: state.activeLeftRailTab,
        activeBottomDockTab: state.activeBottomDockTab,
        leftRailSize: state.leftRailSize,
        rightPanelSize: state.rightPanelSize,
        bottomDockSize: state.bottomDockSize,
      }),
    },
  ),
);
