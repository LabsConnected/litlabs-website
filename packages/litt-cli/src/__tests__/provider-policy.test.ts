/**
 * Client-side routing policy contract.
 *
 * Server-side output-token resolution is covered by
 * terminal-server/__tests__/output-token-policy.test.ts. These tests pin
 * the CLI half of the same policy:
 *
 *   A. 402 / insufficient credits is a HARD STOP, not a retry loop.
 *   B. A native provider key alone makes model execution available.
 *   D. The client always sends an explicit, bounded max_tokens.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  creditRetryEnabled,
  hasAnyNativeProviderKey,
  resolveMaxTokens,
  DEFAULT_MAX_TOKENS,
} from "../lib/model-provider.js";

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "XAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "MISTRAL_API_KEY",
  "MOONSHOT_API_KEY",
  "DASHSCOPE_API_KEY",
  "LITT_CREDIT_RETRY",
  "LITT_MAX_TOKENS",
  "LITT_ALLOW_OPENROUTER_FALLBACK",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("A — 402 is a hard stop", () => {
  it("does not retry after an insufficient-credits rejection by default", () => {
    expect(creditRetryEnabled()).toBe(false);
  });

  it("retries only under the explicit opt-in", () => {
    process.env.LITT_CREDIT_RETRY = "1";
    expect(creditRetryEnabled()).toBe(true);
  });

  it("is not enabled by merely having provider keys", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-key";
    process.env.OPENAI_API_KEY = "sk-proj-key";
    expect(creditRetryEnabled()).toBe(false);
  });
});

describe("B — native credentials count as model availability", () => {
  it("counts OPENAI_API_KEY on its own", () => {
    process.env.OPENAI_API_KEY = "sk-proj-key";
    expect(hasAnyNativeProviderKey()).toBe(true);
  });

  it("is false with no keys at all", () => {
    expect(hasAnyNativeProviderKey()).toBe(false);
  });

  it("does not count an OpenRouter key as a native provider key", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-key";
    expect(hasAnyNativeProviderKey()).toBe(false);
  });

  it("counts other native providers too", () => {
    process.env.DEEPSEEK_API_KEY = "sk-ds-key";
    expect(hasAnyNativeProviderKey()).toBe(true);
  });
});

describe("D — max_tokens is explicit, canonical and bounded", () => {
  it("uses 3000 as the canonical default", () => {
    expect(DEFAULT_MAX_TOKENS).toBe(3000);
    expect(resolveMaxTokens()).toBe(3000);
  });

  it("never yields undefined — the server must never fill in its own default", () => {
    expect(resolveMaxTokens(undefined)).toBe(3000);
    expect(typeof resolveMaxTokens(undefined)).toBe("number");
  });

  it("preserves an explicit caller value", () => {
    expect(resolveMaxTokens(1200)).toBe(1200);
  });

  it("honours the env override", () => {
    process.env.LITT_MAX_TOKENS = "2048";
    expect(resolveMaxTokens()).toBe(2048);
  });

  it("ignores a non-positive override rather than zeroing the request", () => {
    expect(resolveMaxTokens(0)).toBe(3000);
    expect(resolveMaxTokens(-5)).toBe(3000);
  });

  it("is far below the model output ceiling that caused the 402", () => {
    expect(resolveMaxTokens()).toBeLessThan(65536);
  });
});
