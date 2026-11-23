import { afterEach, describe, expect, it, vi } from "vitest";
import { runAI } from "./providers";

const messages = [{ role: "user" as const, content: "Say hello" }];

function mockFetchJson(body: unknown) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENROUTER_API_KEY;
});

describe("runAI — empty completions are provider failures", () => {
  it("rejects when Ollama returns empty content instead of returning \"\"", async () => {
    vi.stubGlobal("fetch", mockFetchJson({ message: { content: "" } }));
    await expect(runAI({ provider: "ollama", messages })).rejects.toThrow(/empty/i);
  });

  it("rejects when Ollama returns whitespace-only content", async () => {
    vi.stubGlobal("fetch", mockFetchJson({ message: { content: "  \n " } }));
    await expect(runAI({ provider: "ollama", messages })).rejects.toThrow(/empty/i);
  });

  it("rejects when Ollama returns no message content at all", async () => {
    vi.stubGlobal("fetch", mockFetchJson({}));
    await expect(runAI({ provider: "ollama", messages })).rejects.toThrow(/empty/i);
  });

  it("rejects when OpenRouter returns empty content instead of returning \"\"", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    vi.stubGlobal("fetch", mockFetchJson({ choices: [{ message: { content: "" } }] }));
    await expect(runAI({ provider: "openrouter", messages })).rejects.toThrow(/empty/i);
  });

  it("rejects when OpenRouter returns whitespace-only content", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    vi.stubGlobal("fetch", mockFetchJson({ choices: [{ message: { content: "   " } }] }));
    await expect(runAI({ provider: "openrouter", messages })).rejects.toThrow(/empty/i);
  });

  it("rejects when OpenRouter returns no choices", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    vi.stubGlobal("fetch", mockFetchJson({ choices: [] }));
    await expect(runAI({ provider: "openrouter", messages })).rejects.toThrow(/empty/i);
  });

  it("still returns real content from both providers", async () => {
    vi.stubGlobal("fetch", mockFetchJson({ message: { content: "hello from ollama" } }));
    await expect(runAI({ provider: "ollama", messages })).resolves.toBe("hello from ollama");

    process.env.OPENROUTER_API_KEY = "test-key";
    vi.stubGlobal("fetch", mockFetchJson({ choices: [{ message: { content: "hello from openrouter" } }] }));
    await expect(runAI({ provider: "openrouter", messages })).resolves.toBe("hello from openrouter");
  });
});
