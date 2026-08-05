/**
 * Selection Store — What is currently selected in the Studio.
 *
 * This drives the Right Inspector panel. When a user clicks an object
 * (component, file, asset, agent, deployment), the selection updates
 * and the inspector shows contextual properties.
 */

import { create } from "zustand";

export type SelectionType =
  | "component"
  | "file"
  | "image"
  | "asset"
  | "agent"
  | "deployment"
  | "workflow"
  | "memory"
  | "database"
  | "none";

export interface Selection {
  id: string;
  type: SelectionType;
  name: string;
  meta?: Record<string, unknown>;
}

interface SelectionState {
  selection: Selection | null;
  select: (selection: Selection) => void;
  clear: () => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selection: null,
  select: (selection) => set({ selection }),
  clear: () => set({ selection: null }),
}));
