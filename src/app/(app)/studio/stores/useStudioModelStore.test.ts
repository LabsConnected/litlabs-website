import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

describe("useStudioModelStore", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.resetModules();
  });

  it("initializes with default model when no localStorage", async () => {
    const { useStudioModelStore } = await import("./useStudioModelStore");
    const state = useStudioModelStore.getState();
    expect(state.selectedModel).toBeDefined();
    expect(state.selectedModel.id).toBe("litt-auto");
  });

  it("restores selected model from localStorage", async () => {
    localStorageMock.setItem("litt-selected-model-v2", "groq-llama-70b");
    const { useStudioModelStore } = await import("./useStudioModelStore");
    const state = useStudioModelStore.getState();
    expect(state.selectedModel.id).toBe("groq-llama-70b");
    expect(state.selectedModel.label).toBe("Groq Llama 70B");
  });

  it("falls back to default when localStorage has invalid model ID", async () => {
    localStorageMock.setItem("litt-selected-model-v2", "nonexistent-model");
    const { useStudioModelStore } = await import("./useStudioModelStore");
    const state = useStudioModelStore.getState();
    expect(state.selectedModel.id).toBe("litt-auto");
  });

  it("selectModel updates the store", async () => {
    const { useStudioModelStore, MODELS } = await import("./useStudioModelStore");
    const geminiModel = MODELS.find((m) => m.id === "gemini-2.5-flash")!;
    useStudioModelStore.getState().selectModel(geminiModel);
    expect(useStudioModelStore.getState().selectedModel.id).toBe("gemini-2.5-flash");
  });

  it("setProviderHealth updates provider health status", async () => {
    const { useStudioModelStore } = await import("./useStudioModelStore");
    useStudioModelStore.getState().setProviderHealth("openai", "locked");
    expect(useStudioModelStore.getState().providerHealth["openai"]).toBe("locked");
  });

  it("MODELS array contains all expected categories", async () => {
    const { MODELS } = await import("./useStudioModelStore");
    const categories = new Set(MODELS.map((m) => m.category));
    // Current categories: litt-alias (LiTT branded models), byok (bring-your-own-key), advanced (raw providers)
    expect(categories.has("litt-alias")).toBe(true);
    expect(categories.has("byok")).toBe(true);
    expect(categories.has("advanced")).toBe(true);
  });
});
