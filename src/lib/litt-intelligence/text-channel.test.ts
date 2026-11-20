import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * D4 — V2 text channel.
 *
 * Before this fix the agent lane had no reply-text channel at any layer:
 * the ProgressEvent union had no text variant, callLLMWithTools exposed
 * no text callback, and the loop's answer was composed whole and sent
 * once in the terminal done payload — so the client's streaming /
 * typewriter rendering never engaged on execution turns.
 *
 * Pinned here:
 *   - callLLMWithTools invokes options.onText once with the serving
 *     attempt's completed text segment (the floor for the non-streaming
 *     adapters);
 *   - a throwing onText observer never breaks the call;
 *   - a { type: "text" } progress event is delivered by ProgressEmitter
 *     and is NOT substantive progress (round-14 stall-clock contract:
 *     text narration must never refresh the watchdog).
 */

vi.mock("@/lib/evals/braintrust", () => ({
  logLLMCall: vi.fn(),
}));

vi.mock("@/lib/siteConfig", () => ({
  SITE_URL: "https://test.example.com",
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("undici", async (importOriginal) => {
  const original = await importOriginal<typeof import("undici")>();
  return {
    ...original,
    fetch: (...args: Parameters<typeof original.fetch>) => mockFetch(...args),
  };
});

import { callLLMWithTools } from "./llm-tool-calling";
import {
  ProgressEmitter,
  isSubstantiveProgressEvent,
  type ProgressEvent,
} from "./progress-events";
import { _resetProviderHealthForTests } from "./provider-registry";
import { _resetModelRegistryForTests } from "./model-registry";

const PROVIDER_ENVS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_AI_API_TOKEN",
  "OLLAMA_BASE_URL",
  "OLLAMA_HOST",
  "OLLAMA_HOST_PC",
  "LITT_OLLAMA_URL",
  "OLLAMA_MODEL",
  "OPENROUTER_MODEL",
  "GROQ_MODEL",
  "MISTRAL_MODEL",
  "CLOUDFLARE_AI_MODEL",
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_PROJECT_ID",
  "VERCEL",
];

function clearProviderEnvs() {
  for (const key of PROVIDER_ENVS) vi.stubEnv(key, "");
  vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
}

function makeGeminiSuccessResponse(text: string) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({
      candidates: [{ content: { parts: [{ text }] } }],
    }),
    text: async () => "",
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  _resetProviderHealthForTests();
  _resetModelRegistryForTests();
  vi.unstubAllEnvs();
  clearProviderEnvs();
  vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
});

afterEach(() => {
  _resetProviderHealthForTests();
  _resetModelRegistryForTests();
  vi.unstubAllEnvs();
});

describe("callLLMWithTools — onText observer (D4)", () => {
  it("emits the serving attempt's text segment to onText", async () => {
    mockFetch.mockResolvedValue(makeGeminiSuccessResponse("Hello from the model"));
    const segments: string[] = [];

    const res = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Say hello" }],
      [],
      { onText: (text) => segments.push(text) },
    );

    expect(res.text).toBe("Hello from the model");
    expect(segments).toEqual(["Hello from the model"]);
  });

  it("a throwing onText observer never breaks the call", async () => {
    mockFetch.mockResolvedValue(makeGeminiSuccessResponse("Still fine"));

    const res = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Say hello" }],
      [],
      {
        onText: () => {
          throw new Error("observer exploded");
        },
      },
    );

    expect(res.text).toBe("Still fine");
  });

  it("does not emit onText when no observer is registered", async () => {
    mockFetch.mockResolvedValue(makeGeminiSuccessResponse("Quiet"));
    const res = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Say hello" }],
      [],
    );
    expect(res.text).toBe("Quiet");
  });
});

describe("ProgressEvent text variant (D4)", () => {
  it("is delivered by ProgressEmitter like any other event", () => {
    const seen: ProgressEvent[] = [];
    const emitter = new ProgressEmitter((evt) => seen.push(evt));
    emitter.emit({ type: "text", text: "partial answer" });
    expect(seen).toEqual([{ type: "text", text: "partial answer" }]);
  });

  it("is NOT substantive progress (round-14 stall clock must not refresh on narration)", () => {
    expect(isSubstantiveProgressEvent({ type: "text", text: "x" })).toBe(false);
  });
});
