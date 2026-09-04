/**
 * P0-8: Doctor Effective Provider — regression tests.
 *
 * Proves:
 *   - LOCAL + qwen3:4b-instruct (ollama model) → effective provider = Ollama
 *   - REMOTE + OpenAI key → effective provider = OpenAI
 *   - LOCAL + no ollama model/endpoint → effective provider = none
 *   - Remote credentials are reported separately from the active provider
 *
 * The bug: doctor showed "Provider: OpenAI" just because an OpenAI key
 * existed, even when LOCAL execution + an Ollama model was the active route.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  collectStartupStatus,
  formatStartupStatus,
} from "../lib/startup-status.js";

const tmpDir = path.join(os.tmpdir(), `litt-p0-provider-${Date.now()}`);

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "test-project" }));
  // Use a temp LITT_HOME so we don't read the user's real prefs
  process.env.LITT_HOME = tmpDir;
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* ignore */ }
  // Clean up env vars that might have been set
  delete process.env.LITT_TARGET_OVERRIDE;
  delete process.env.OLLAMA_BASE_URL;
  delete process.env.OLLAMA_HOST_PC;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.LITT_HOME;
});

describe("P0-8: Doctor Effective Provider", () => {
  describe("LOCAL + Ollama model → effective provider = Ollama", () => {
    it("reports Ollama as the active provider when LOCAL + ollama: model", () => {
      // Set LOCAL target
      process.env.LITT_TARGET_OVERRIDE = "local";
      // Set an Ollama endpoint
      process.env.OLLAMA_BASE_URL = "http://localhost:11434";
      // Also set an OpenAI key — this must NOT override the effective provider
      process.env.OPENAI_API_KEY = "sk-test-key";

      const status = collectStartupStatus(tmpDir);
      expect(status.execution).toBe("LOCAL");
      expect(status.provider).toBe("Ollama");
    });

    it("reports Ollama even when model starts with ollama: prefix", () => {
      process.env.LITT_TARGET_OVERRIDE = "local";
      process.env.OPENAI_API_KEY = "sk-test-key";
      // No OLLAMA_BASE_URL, but write a prefs file with an ollama: model
      fs.writeFileSync(path.join(tmpDir, "model-prefs.json"), JSON.stringify({
        prefsVersion: 2,
        routingMode: "fixed",
        selectedModel: "ollama:qwen3:4b-instruct",
        capabilityOverrides: {},
        lastUsedModel: null,
        showFallbackNotifications: true,
      }));
      // The effective provider should be Ollama because the model
      // is an Ollama model and we're in LOCAL mode.
      const status = collectStartupStatus(tmpDir);
      expect(status.execution).toBe("LOCAL");
      expect(status.provider).toBe("Ollama");
    });

    it("does NOT report OpenAI as provider when LOCAL + Ollama is active", () => {
      process.env.LITT_TARGET_OVERRIDE = "local";
      process.env.OLLAMA_BASE_URL = "http://localhost:11434";
      process.env.OPENAI_API_KEY = "sk-test-key";

      const status = collectStartupStatus(tmpDir);
      expect(status.provider).not.toBe("OpenAI");
      expect(status.provider).toBe("Ollama");
    });
  });

  describe("REMOTE + OpenAI key → effective provider = OpenAI", () => {
    it("reports OpenAI as the active provider when REMOTE + OpenAI key", () => {
      process.env.LITT_TARGET_OVERRIDE = "remote";
      process.env.OPENAI_API_KEY = "sk-test-key";

      const status = collectStartupStatus(tmpDir);
      expect(status.execution).toBe("REMOTE");
      expect(status.provider).toBe("OpenAI");
    });

    it("reports Groq when REMOTE + Groq key (no OpenAI)", () => {
      process.env.LITT_TARGET_OVERRIDE = "remote";
      process.env.GROQ_API_KEY = "gsk_test";
      // No OPENAI_API_KEY

      const status = collectStartupStatus(tmpDir);
      expect(status.execution).toBe("REMOTE");
      expect(status.provider).toBe("Groq");
    });
  });

  describe("LOCAL + no Ollama → effective provider = none", () => {
    it("reports none when LOCAL + no ollama model/endpoint", () => {
      process.env.LITT_TARGET_OVERRIDE = "local";
      // No Ollama, no OpenAI key
      const status = collectStartupStatus(tmpDir);
      expect(status.execution).toBe("LOCAL");
      expect(status.provider).toBe("none");
    });
  });

  describe("formatStartupStatus shows provider correctly", () => {
    it("shows Ollama as Provider when LOCAL + Ollama", () => {
      process.env.LITT_TARGET_OVERRIDE = "local";
      process.env.OLLAMA_BASE_URL = "http://localhost:11434";
      process.env.OPENAI_API_KEY = "sk-test-key";

      const status = collectStartupStatus(tmpDir);
      const text = formatStartupStatus(status);
      expect(text).toContain("Provider:");
      expect(text).toContain("Ollama");
      expect(text).not.toMatch(/Provider:.*OpenAI/);
    });
  });
});
