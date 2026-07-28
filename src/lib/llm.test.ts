/**
 * LLM Routing Tests — verifies that openrouter-free (random model pool)
 * is never included in automatic conversational fallback chains.
 *
 * openrouter-free maps to "openrouter/free" which randomly selects from
 * a pool of free models. This is incompatible with personality-critical
 * chat — it can return a classifier-like model on one request and a
 * capable chat model on another.
 */

import { describe, it, expect } from "vitest";
import { defaultChain, type LLMOptions } from "./llm";

describe("defaultChain — openrouter-free exclusion", () => {
  it("auto category does not include openrouter-free", () => {
    const chain = defaultChain("chat", { category: "auto" } as LLMOptions);
    expect(chain).not.toContain("openrouter-free");
  });

  it("free category does not include openrouter-free", () => {
    const chain = defaultChain("chat", { category: "free" } as LLMOptions);
    expect(chain).not.toContain("openrouter-free");
  });

  it("fast category does not include openrouter-free", () => {
    const chain = defaultChain("chat", { category: "fast" } as LLMOptions);
    expect(chain).not.toContain("openrouter-free");
  });

  it("creative category does not include openrouter-free", () => {
    const chain = defaultChain("creative", { category: "creative" } as LLMOptions);
    expect(chain).not.toContain("openrouter-free");
  });

  it("code category does not include openrouter-free", () => {
    const chain = defaultChain("code", { category: "code" } as LLMOptions);
    expect(chain).not.toContain("openrouter-free");
  });

  it("byok category does not include openrouter-free", () => {
    const chain = defaultChain("chat", { category: "byok" } as LLMOptions);
    expect(chain).not.toContain("openrouter-free");
  });

  it("default chat task does not include openrouter-free", () => {
    const chain = defaultChain("chat", {} as LLMOptions);
    expect(chain).not.toContain("openrouter-free");
  });

  it("creative task does not include openrouter-free", () => {
    const chain = defaultChain("creative", {} as LLMOptions);
    expect(chain).not.toContain("openrouter-free");
  });

  it("precise task does not include openrouter-free", () => {
    const chain = defaultChain("precise", {} as LLMOptions);
    expect(chain).not.toContain("openrouter-free");
  });

  it("json task does not include openrouter-free", () => {
    const chain = defaultChain("json", {} as LLMOptions);
    expect(chain).not.toContain("openrouter-free");
  });

  it("preferFree option does not include openrouter-free", () => {
    const chain = defaultChain("chat", { preferFree: true } as LLMOptions);
    expect(chain).not.toContain("openrouter-free");
  });
});

describe("defaultChain — explicit provider selection still works", () => {
  it("explicit openrouter-free provider is reachable when directly chosen", () => {
    const chain = defaultChain("chat", { provider: "openrouter-free" } as LLMOptions);
    expect(chain).toEqual(["openrouter-free"]);
  });

  it("explicit provider overrides category", () => {
    const chain = defaultChain("chat", {
      provider: "openrouter-free",
      category: "auto",
    } as LLMOptions);
    expect(chain).toEqual(["openrouter-free"]);
  });
});

describe("defaultChain — specific OpenRouter models remain for specialized routes", () => {
  it("code task uses openrouter-qwen (specific model, not random pool)", () => {
    const chain = defaultChain("code", {} as LLMOptions);
    expect(chain).toContain("openrouter-qwen");
    expect(chain).not.toContain("openrouter-free");
  });

  it("precise task uses openrouter-deepseek (specific model)", () => {
    const chain = defaultChain("precise", {} as LLMOptions);
    expect(chain).toContain("openrouter-deepseek");
    expect(chain).not.toContain("openrouter-free");
  });

  it("vision task uses openrouter-vision (specific model)", () => {
    const chain = defaultChain("vision", {} as LLMOptions);
    expect(chain).toContain("openrouter-vision");
    expect(chain).not.toContain("openrouter-free");
  });

  it("vision category uses openrouter-vision (specific model)", () => {
    const chain = defaultChain("vision", { category: "vision" } as LLMOptions);
    expect(chain).toContain("openrouter-vision");
    expect(chain).not.toContain("openrouter-free");
  });
});

describe("defaultChain — deterministic provider ordering", () => {
  it("auto uses Gemini first, then Groq", () => {
    const chain = defaultChain("chat", { category: "auto" } as LLMOptions);
    expect(chain[0]).toBe("gemini");
    expect(chain[1]).toBe("groq");
    expect(chain.length).toBe(2);
  });

  it("fast uses Groq first, then Gemini", () => {
    const chain = defaultChain("chat", { category: "fast" } as LLMOptions);
    expect(chain[0]).toBe("groq");
    expect(chain[1]).toBe("gemini");
  });

  it("default chat uses Gemini first, then Groq", () => {
    const chain = defaultChain("chat", {} as LLMOptions);
    expect(chain[0]).toBe("gemini");
    expect(chain[1]).toBe("groq");
  });
});
