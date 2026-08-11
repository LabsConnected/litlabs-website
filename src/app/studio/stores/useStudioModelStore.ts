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
  description?: string;
  apiModel?: string;
  apiProvider?: string;
  category?: "auto" | "free" | "fast" | "code" | "creative" | "vision" | "byok" | "litt-alias" | "advanced";
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
  description: m.description,
  apiModel: m.apiModel,
  apiProvider: m.apiProvider,
  category: m.category,
}));

export const RECOMMENDED_IDS = CHAT_MODELS.filter((m) => m.recommended).map((m) => m.id);

const DEFAULT_MODEL = MODELS.find((m) => m.id === "litt-balanced") ?? MODELS[0];

function getInitialModel(): SelectedModel {
  if (typeof window === "undefined") return DEFAULT_MODEL;
  try {
    const savedId = localStorage.getItem("litt-selected-model-v2");
    if (savedId) {
      const found = MODELS.find((m) => m.id === savedId);
      if (found) return found;
    }
  } catch {
    // ignore
  }
  return DEFAULT_MODEL;
}

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
    description: m.description,
    apiModel: m.apiModel,
    apiProvider: m.apiProvider,
    category: m.category,
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
  selectedModel: getInitialModel(),
  providerHealth: {},
  fallbackNotice: null,

  selectModel: (model) => {
    const selectedModel = "apiModel" in model && "label" in model
      ? model as SelectedModel
      : toSelectedModel(model as StudioModel);
    try {
      localStorage.setItem("litt-selected-model-v2", selectedModel.id);
    } catch {
      // Storage may be unavailable in private or restricted browser contexts.
    }
    set({ selectedModel });
  },

  setFallbackNotice: (fallbackNotice) => set({ fallbackNotice }),
  setProviderHealth: (provider, health) =>
    set((state) => ({
      providerHealth: { ...state.providerHealth, [provider]: health },
    })),
}));
