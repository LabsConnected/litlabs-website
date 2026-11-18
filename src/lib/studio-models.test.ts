import { describe, it, expect } from "vitest";
import { CHAT_MODELS, CODE_MODELS } from "./studio-models";

// Display-name truth for the model catalog. Regression coverage for the
// 2026-11-11 audit: the picker advertised "Gemini 3.6 Flash" (an entry that
// actually serves gemini-2.5-flash; no 3.6 model exists in the registry or
// any route) and "Groq Llama 70B" (retired from Groq's catalog; the entry
// serves openai/gpt-oss-120b).

const all = [...CHAT_MODELS, ...CODE_MODELS];

describe("studio model catalog names match what the entries serve", () => {
  it("no entry advertises a Gemini 3.6 that does not exist", () => {
    for (const m of all) {
      expect(m.name, m.id).not.toMatch(/3\.6/);
    }
  });

  it("the raw gemini-2.5-flash pick is named Gemini 2.5 Flash", () => {
    // (LiTT alias entries like "LiTT Auto" also route here — an alias name
    // is honest for those; the RAW provider pick must name the real model.)
    const entry = CHAT_MODELS.find((m) => m.id === "gemini-2.5-flash");
    expect(entry?.apiModel).toBe("gemini-2.5-flash");
    expect(entry?.name).toBe("Gemini 2.5 Flash");
  });

  it("no entry advertises the retired Groq Llama 70B", () => {
    for (const m of all) {
      expect(m.name, m.id).not.toMatch(/Llama 70B/i);
    }
  });

  it("the raw Groq pick serving openai/gpt-oss-120b says so", () => {
    for (const m of all) {
      if (m.provider === "groq" && m.apiModel === "openai/gpt-oss-120b") {
        expect(m.name, m.id).toContain("GPT-OSS 120B");
      }
    }
    const code = CODE_MODELS.find((m) => m.id === "groq-llama");
    expect(code?.name).toContain("GPT-OSS 120B");
  });
});
