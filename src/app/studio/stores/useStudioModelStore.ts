import { create } from "zustand";
import { CHAT_MODELS, type StudioModel } from "@/lib/studio-models";

export type SelectedModel = {
  id: string;
  label: string;
  provider: string;
  name: string;
  model: string;
  cost: "free" | "paid" | "hybrid";
  speed: "fast" | "medium" | "slow";
  icon: string;
  apiModel?: string;
  apiProvider?: string;
};

export type ProviderHealth = "available" | "degraded" | "unavailable" | "locked";

export const MODELS: SelectedModel[] = CHAT_MODELS.map((m) => ({
  id: m.id,
  label: m.name,
  provider: m.provider,
  name: m.name,
  model: m.apiModel || m.id,
  cost: m.cost,
  speed: m.speed,
  icon: m.icon,
  apiModel: m.apiModel,
  apiProvider: m.apiProvider,
}));

export const RECOMMENDED_IDS = CHAT_MODELS.filter((m) => m.recommended).map((m) => m.id);

const DEFAULT_MODEL = MODELS[0];

function toSelectedModel(m: StudioModel): SelectedModel {
  return {
    id: m.id,
    label: m.name,
    provider: m.provider,
    name: m.name,
    model: m.apiModel || m.id,
    cost: m.cost,
    speed: m.speed,
    icon: m.icon,
    apiModel: m.apiModel,
    apiProvider: m.apiProvider,
  };
}

interface StudioModelStore {
  selectedModel: SelectedModel;
  providerHealth: Record<string, ProviderHealth>;
  fallbackNotice: string | null;
  selectModel: (model: SelectedModel | StudioModel) => void;
  setFallbackNotice: (notice: string | null) => void;
  setProviderHealth: (provider: string, health: ProviderHealth) => void;
}

export const useStudioModelStore = create<StudioModelStore>((set) => ({
  selectedModel: DEFAULT_MODEL,
  providerHealth: {},
  fallbackNotice: null,

  selectModel: (model) =>
    set({
      selectedModel: "apiModel" in model && "label" in model
        ? model as SelectedModel
        : toSelectedModel(model as StudioModel),
    }),

  setFallbackNotice: (fallbackNotice) => set({ fallbackNotice }),
  setProviderHealth: (provider, health) =>
    set((state) => ({
      providerHealth: { ...state.providerHealth, [provider]: health },
    })),
}));
