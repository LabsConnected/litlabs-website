import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getEligibleModels,
  validateEnvOverride,
  recordHealthOutcome,
  selectBuildModel,
  resolveRegistryModel,
  findModelRecord,
  getModelConfigSource,
  NO_BUILD_CAPABLE_MODEL,
  _resetModelRegistryForTests,
} from "./model-registry";

beforeEach(() => {
  _resetModelRegistryForTests();
  vi.unstubAllEnvs();
});

afterEach(() => {
  _resetModelRegistryForTests();
  vi.unstubAllEnvs();
});

describe("model registry — eligibility", () => {
  it("orders build models by priority: gemini-flash first", () => {
    const models = getEligibleModels({ tools: true, reliableFileWriting: true });
    const ids = models.map((m) => m.canonicalId);
    expect(ids[0]).toBe("gemini-flash");
    expect(ids[1]).toBe("gemini-2.5-flash");
    // Chat-only and unhealthy models are NEVER build models
    expect(ids).not.toContain("openrouter-north-mini-code");
    expect(ids).not.toContain("openrouter-nemotron-3.5-lightning");
    // qwen3.8-27b:free is catalog-valid with tool calling but not yet
    // run-proven as a file writer — also never a build model until promoted.
    expect(ids).not.toContain("openrouter-qwen3.8-27b");
  });

  it("keeps north-mini-code eligible for tool chat (but not build)", () => {
    const chat = getEligibleModels({ tools: true });
    expect(chat.map((m) => m.canonicalId)).toContain("openrouter-north-mini-code");
  });

  it("excludes vision-incapable openrouter models from vision queries", () => {
    const vision = getEligibleModels({ vision: true });
    // qwen3.8-27b:free takes image input per the OpenRouter catalog
    // (modality text+image+video->text); gemma/north-mini/nemotron do not.
    expect(vision.map((m) => m.canonicalId)).toEqual([
      "gemini-flash",
      "gemini-2.5-flash",
      "openrouter-qwen3.8-27b",
    ]);
  });

  it("selectBuildModel returns the highest-priority build model", () => {
    const m = selectBuildModel();
    expect(m?.canonicalId).toBe("gemini-flash");
    expect(m?.providerModelId).toBe("gemini-flash-latest");
  });

  it("selectBuildModel honours exclusions and returns null when exhausted", () => {
    const second = selectBuildModel(["gemini-flash"]);
    expect(second?.canonicalId).toBe("gemini-2.5-flash");
    const none = selectBuildModel([
      "gemini-flash",
      "gemini-2.5-flash",
      "openrouter-qwen3.8-27b",
      "openrouter-gemma-4-31b",
    ]);
    expect(none).toBeNull();
  });

  it("selectBuildModel never returns a chat-only model (north-mini-code excluded from BUILD)", () => {
    // north-mini-code is tool-capable (chat-eligible) but proven read-only —
    // it must never be selected for BUILD.
    const chat = getEligibleModels({ tools: true }).map((m) => m.canonicalId);
    expect(chat).toContain("openrouter-north-mini-code");
    const picked = selectBuildModel();
    expect(picked).not.toBeNull();
    expect(picked!.canonicalId).not.toBe("openrouter-north-mini-code");
    expect(picked!.capabilities.reliableFileWriting).toBe(true);
    // Exclude every proven writer: no build model remains — the result is
    // null, never the chat-only model as a silent fallback.
    const none = selectBuildModel([
      "gemini-flash",
      "gemini-2.5-flash",
      "openrouter-qwen3.8-27b",
      "openrouter-gemma-4-31b",
    ]);
    expect(none).toBeNull();
  });

  it("findModelRecord maps provider + providerModelId to canonicalId", () => {
    expect(findModelRecord("gemini", "gemini-flash-latest")?.canonicalId).toBe("gemini-flash");
    expect(findModelRecord("openrouter", "cohere/north-mini-code:free")?.canonicalId).toBe(
      "openrouter-north-mini-code",
    );
    expect(findModelRecord("openrouter", "nope/not-real:free")).toBeUndefined();
  });
});

describe("model registry — env override validation", () => {
  it("accepts a known providerModelId", () => {
    const r = validateEnvOverride("GEMINI_PRIMARY_MODEL", "gemini-flash-latest", { tools: true });
    expect(r.valid).toBe(true);
    expect(r.record?.canonicalId).toBe("gemini-flash");
  });

  it("accepts a canonicalId and resolves to its providerModelId", () => {
    const r = validateEnvOverride("GEMINI_PRIMARY_MODEL", "gemini-2.5-flash", { tools: true });
    expect(r.valid).toBe(true);
    expect(r.record?.providerModelId).toBe("gemini-2.5-flash");
  });

  it("rejects unknown strings with an explicit error naming var, value, and reason", () => {
    const r = validateEnvOverride("OPENROUTER_MODEL", "qwen/qwen3-coder:free", { tools: true });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("OPENROUTER_MODEL");
    expect(r.error).toContain("qwen/qwen3-coder:free");
    expect(r.error).toContain("not a known registry model");
  });

  it("rejects a known model that lacks required capabilities", () => {
    const r = validateEnvOverride("OPENROUTER_MODEL", "cohere/north-mini-code:free", {
      tools: true,
      reliableFileWriting: true,
    });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("reliableFileWriting");
  });
});

describe("model registry — env resolution", () => {
  it("uses the registry default when the env var is absent", () => {
    const r = resolveRegistryModel("GEMINI_PRIMARY_MODEL", "gemini-flash", { tools: true });
    expect(r.providerModelId).toBe("gemini-flash-latest");
    expect(r.source).toBe("registry");
    expect(getModelConfigSource("gemini-flash")).toBe("registry");
  });

  it("honours a valid env override and records configSource", () => {
    vi.stubEnv("GEMINI_PRIMARY_MODEL", "gemini-2.5-flash");
    const r = resolveRegistryModel("GEMINI_PRIMARY_MODEL", "gemini-flash", { tools: true });
    expect(r.providerModelId).toBe("gemini-2.5-flash");
    expect(r.source).toBe("env-override");
    expect(r.canonicalId).toBe("gemini-2.5-flash");
    expect(getModelConfigSource("gemini-2.5-flash")).toBe("env-override");
  });

  it("rejects an invalid env override with a warning and falls back to the registry default", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("GEMINI_PRIMARY_MODEL", "gemini-9.9-ultra");
    const r = resolveRegistryModel("GEMINI_PRIMARY_MODEL", "gemini-flash", { tools: true });
    expect(r.providerModelId).toBe("gemini-flash-latest");
    expect(r.source).toBe("registry");
    expect(warn).toHaveBeenCalledOnce();
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain("GEMINI_PRIMARY_MODEL");
    expect(msg).toContain("gemini-9.9-ultra");
    warn.mockRestore();
  });
});

describe("model registry — health learning", () => {
  it("marks a model unhealthy after 3 consecutive failures", () => {
    recordHealthOutcome("gemini-flash", false, "timeout");
    recordHealthOutcome("gemini-flash", false, "timeout");
    let eligible = getEligibleModels({ tools: true }).map((m) => m.canonicalId);
    expect(eligible).toContain("gemini-flash"); // degraded, still eligible
    recordHealthOutcome("gemini-flash", false, "timeout");
    eligible = getEligibleModels({ tools: true }).map((m) => m.canonicalId);
    expect(eligible).not.toContain("gemini-flash");
    expect(selectBuildModel()?.canonicalId).toBe("gemini-2.5-flash");
  });

  it("a success recovers a model to healthy", () => {
    recordHealthOutcome("gemini-flash", false, "timeout");
    recordHealthOutcome("gemini-flash", false, "timeout");
    recordHealthOutcome("gemini-flash", false, "timeout");
    expect(getEligibleModels({ tools: true }).map((m) => m.canonicalId)).not.toContain("gemini-flash");
    recordHealthOutcome("gemini-flash", true, "");
    expect(getEligibleModels({ tools: true }).map((m) => m.canonicalId)).toContain("gemini-flash");
  });

  it("ignores unknown canonicalIds", () => {
    expect(() => recordHealthOutcome("nope", false, "timeout")).not.toThrow();
  });

  it("exposes the NO_BUILD_CAPABLE_MODEL error code", () => {
    expect(NO_BUILD_CAPABLE_MODEL).toBe("NO_BUILD_CAPABLE_MODEL");
  });
});
