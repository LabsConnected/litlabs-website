/**
 * Ollama capability-based model selection.
 *
 * pickOllamaModel must trust /api/tags' reported capabilities — not model
 * names — so custom-tagged builds (litt-fast:2k, litt-coder:latest) are
 * eligible for tool requests and completion-only models are rejected.
 */
import { describe, it, expect, afterEach } from "vitest";
import { pickOllamaModel, type OllamaModelInfo } from "./llm-tool-calling.js";

const m = (name: string, capabilities: string[] | null): OllamaModelInfo => ({ name, capabilities });

afterEach(() => {
  delete process.env.OLLAMA_MODEL;
});

describe("pickOllamaModel — capabilities-based tool eligibility", () => {
  it("selects a litt-* model reporting 'tools' for tool-required requests", () => {
    const available = [m("litt-fast:2k", ["completion", "tools", "thinking"]), m("phi3", ["completion"])];
    expect(pickOllamaModel(available, true)).toBe("litt-fast:2k");
  });

  it("rejects completion-only models for tool-required requests", () => {
    const available = [m("some-completion-only:1b", ["completion"])];
    expect(pickOllamaModel(available, true)).toBeNull();
  });

  it("falls back to the family-name regex when capabilities are absent", () => {
    const available = [m("litt-fast:2k", null), m("qwen3:4b", null)];
    expect(pickOllamaModel(available, true)).toBe("qwen3:4b");
  });

  it("name-regex fallback still rejects unknown families without capabilities", () => {
    expect(pickOllamaModel([m("my-random-model", null)], true)).toBeNull();
  });

  it("prefers litt-coder over generic tool-capable models for tool requests", () => {
    const available = [
      m("qwen3:4b", ["tools", "completion"]),
      m("litt-coder:latest", ["tools", "thinking", "completion"]),
    ];
    expect(pickOllamaModel(available, true)).toBe("litt-coder:latest");
  });

  it("prefers litt-fast for non-tool requests", () => {
    const available = [m("litt-coder:latest", ["tools"]), m("litt-fast:2k", ["tools", "completion"])];
    expect(pickOllamaModel(available, false)).toBe("litt-fast:2k");
  });

  it("OLLAMA_MODEL override always wins", () => {
    process.env.OLLAMA_MODEL = "qwen3:1.7b";
    const available = [m("litt-coder:latest", ["tools"])];
    expect(pickOllamaModel(available, true)).toBe("qwen3:1.7b");
  });

  it("returns null when nothing is installed", () => {
    expect(pickOllamaModel([], false)).toBeNull();
  });
});
