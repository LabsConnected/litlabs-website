import { describe, it, expect } from "vitest";

import { resolveSelectedModelHealth } from "./model-health";
import type { ProviderHealth, SelectedModel } from "../stores/useStudioModelStore";

const health = (entries: Record<string, ProviderHealth>) => entries;
const model = (m: Pick<SelectedModel, "provider" | "apiProvider" | "category">) => m;

describe("resolveSelectedModelHealth", () => {
  it("resolves LiTT-routed models to the whole-chain Auto roll-up, not the preferred provider", () => {
    // The incident: gemini's key is dead but the chain still answers via
    // another route (local tail). Auto says "degraded"; the preferred
    // apiProvider says "unavailable". The chain roll-up is the truth.
    const h = health({ Auto: "degraded", gemini: "unavailable", ollama: "available" });
    expect(
      resolveSelectedModelHealth(
        model({ provider: "LiTT", apiProvider: "gemini", category: "litt-alias" }),
        h,
      ),
    ).toBe("degraded");
  });

  it("reports LiTT Auto available when only the local Ollama tail remains", () => {
    const h = health({ Auto: "degraded", gemini: "unavailable", groq: "unavailable", openrouter: "unavailable", ollama: "available" });
    expect(
      resolveSelectedModelHealth(
        model({ provider: "LiTT", apiProvider: "gemini", category: "litt-alias" }),
        h,
      ),
    ).not.toBe("unavailable");
  });

  it("falls back to apiProvider/provider when the Auto roll-up is unknown", () => {
    const h = health({ auto: "unavailable" });
    expect(
      resolveSelectedModelHealth(
        model({ provider: "auto", apiProvider: "", category: "auto" }),
        h,
      ),
    ).toBe("unavailable");
  });

  it("resolves an explicit ollama/<tag> pin to the ollama route's own health", () => {
    const up = health({ Auto: "degraded", ollama: "available" });
    expect(
      resolveSelectedModelHealth(
        model({ provider: "ollama", apiProvider: "ollama", category: "local" }),
        up,
      ),
    ).toBe("available");

    const down = health({ Auto: "available", ollama: "unavailable" });
    expect(
      resolveSelectedModelHealth(
        model({ provider: "ollama", apiProvider: "ollama", category: "local" }),
        down,
      ),
    ).toBe("unavailable");
  });

  it("resolves a pinned cloud provider to its own health, not the Auto roll-up", () => {
    const h = health({ Auto: "available", groq: "unavailable" });
    expect(
      resolveSelectedModelHealth(
        model({ provider: "groq", apiProvider: "groq", category: "advanced" }),
        h,
      ),
    ).toBe("unavailable");
  });

  it("returns undefined while health is unverified", () => {
    expect(
      resolveSelectedModelHealth(
        model({ provider: "ollama", apiProvider: "ollama", category: "local" }),
        health({}),
      ),
    ).toBeUndefined();
    expect(
      resolveSelectedModelHealth(
        model({ provider: "LiTT", apiProvider: "gemini", category: "litt-alias" }),
        health({}),
      ),
    ).toBeUndefined();
  });
});
