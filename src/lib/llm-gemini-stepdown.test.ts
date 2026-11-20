// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";

/**
 * D3 — V1 Gemini flash → flash-lite stepdown.
 *
 * The V1 lanes (streamText for plain chat, generateText for non-streaming
 * V1 calls) used to attempt exactly ONE Gemini model per call: a 429 on
 * gemini-2.5-flash failed the whole provider even though flash-lite sits
 * on a separate per-model quota pool. The V2 agent lane already steps
 * down within the call (per-model rate limits); these tests pin the V1
 * behaviour to match:
 *   - streaming: a pre-output 429 on the requested model retries ONCE on
 *     gemini-2.5-flash-lite inside the same call;
 *   - streaming: a 429 AFTER chunks streamed does NOT restart (the
 *     prefix would duplicate) — the chain fails over as before;
 *   - streaming: non-429 failures do not step down;
 *   - non-streaming: a 429 on gemini-2.5-flash (the fallback model, so
 *     the existing primary→fallback retry cannot fire) steps down to
 *     flash-lite; a non-429 failure does not.
 *
 * Keys are module-level consts in llm.ts, so env is set BEFORE the
 * dynamic import, mirroring llm-retries.test.ts.
 */

vi.mock("@/lib/metrics", () => ({ recordLLMCall: vi.fn() }));
vi.mock("@/lib/evals/braintrust", () => ({ logLLMCall: vi.fn() }));

const { geminiGenerateMock, geminiStreamMock, requestedModels } = vi.hoisted(
  () => ({
    geminiGenerateMock: vi.fn(),
    geminiStreamMock: vi.fn(),
    requestedModels: [] as string[],
  }),
);
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel(config: { model: string }) {
      requestedModels.push(config.model);
      return {
        generateContent: (...args: unknown[]) =>
          geminiGenerateMock(config.model, ...args),
        generateContentStream: (...args: unknown[]) =>
          geminiStreamMock(config.model, ...args),
      };
    }
  },
}));

vi.mock("@/lib/metering", () => ({
  emitLlmMetering: vi.fn(async () => ({ usageEventId: "evt" })),
  getMeteringContext: () => undefined,
}));
vi.mock("@/lib/spend-guards", () => ({
  checkRunawayGuards: vi.fn(async () => ({ allowed: true })),
  SpendGuardError: class SpendGuardError extends Error {},
}));

const prevGeminiKey = process.env.GEMINI_API_KEY;

beforeAll(() => {
  process.env.GEMINI_API_KEY = "test-gemini-key";
});

afterAll(() => {
  if (prevGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = prevGeminiKey;
});

afterEach(() => {
  geminiGenerateMock.mockReset();
  geminiStreamMock.mockReset();
  requestedModels.length = 0;
  vi.unstubAllGlobals();
});

const err429 = () =>
  new Error(
    "[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/x:generateContent: [429 Too Many Requests] quota exceeded",
  );
const err503 = () =>
  new Error(
    "[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/x:generateContent: [503 Service Unavailable] high demand",
  );
const err400 = () =>
  new Error("[GoogleGenerativeAI Error]: [400 Bad Request] invalid request");

function streamOf(chunks: string[]) {
  return {
    stream: (async function* () {
      for (const c of chunks) {
        yield { text: () => c, candidates: [{ finishReason: "STOP" }] };
      }
    })(),
  };
}

describe("streamText — Gemini 429 stepdown to flash-lite (D3)", () => {
  it("steps down within the same call on a pre-output 429", async () => {
    geminiStreamMock.mockImplementation((model: string) => {
      if (model === "gemini-2.5-flash") return Promise.reject(err429());
      return Promise.resolve(streamOf(["lite-", "reply"]));
    });

    const { streamText } = await import("./llm");
    const chunks: string[] = [];
    const res = await streamText(
      "hi",
      (c) => chunks.push(c),
      {
        task: "chat",
        provider: "gemini",
        modelOverride: { gemini: "gemini-2.5-flash" },
      },
    );

    expect(res.provider).toBe("gemini");
    expect(res.model).toBe("gemini-2.5-flash-lite");
    expect(chunks.join("")).toBe("lite-reply");
    expect(requestedModels).toEqual([
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
    ]);
  });

  it("does NOT step down after output already streamed (no duplicated prefix)", async () => {
    geminiStreamMock.mockImplementation(() => ({
      stream: (async function* () {
        yield { text: () => "partial-", candidates: [] };
        throw err429();
      })(),
    }));

    const { streamText } = await import("./llm");
    const chunks: string[] = [];
    await expect(
      streamText("hi", (c) => chunks.push(c), {
        task: "chat",
        provider: "gemini",
        modelOverride: { gemini: "gemini-2.5-flash" },
      }),
    ).rejects.toThrow(/All LLM streaming providers failed/);

    expect(chunks.join("")).toBe("partial-");
    expect(requestedModels).toEqual(["gemini-2.5-flash"]);
  });

  it("does not step down on a non-429 failure", async () => {
    geminiStreamMock.mockRejectedValue(err503());

    const { streamText } = await import("./llm");
    await expect(
      streamText("hi", () => {}, {
        task: "chat",
        provider: "gemini",
        modelOverride: { gemini: "gemini-2.5-flash" },
      }),
    ).rejects.toThrow(/All LLM streaming providers failed/);

    expect(requestedModels).toEqual(["gemini-2.5-flash"]);
  });
});

describe("generateText — Gemini 429 stepdown to flash-lite (D3)", () => {
  const okResult = (text: string) => ({
    response: {
      text: () => text,
      usageMetadata: {
        promptTokenCount: 3,
        candidatesTokenCount: 2,
        totalTokenCount: 5,
      },
    },
  });

  it("steps down to flash-lite when gemini-2.5-flash itself 429s", async () => {
    geminiGenerateMock.mockImplementation((model: string) => {
      if (model === "gemini-2.5-flash") return Promise.reject(err429());
      return Promise.resolve(okResult("lite-ok"));
    });

    const { generateText } = await import("./llm");
    const res = await generateText("hi", {
      task: "chat",
      provider: "gemini",
      modelOverride: { gemini: "gemini-2.5-flash" },
    });

    expect(res.provider).toBe("gemini");
    expect(res.model).toBe("gemini-2.5-flash-lite");
    expect(res.text).toBe("lite-ok");
    expect(requestedModels).toEqual([
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
    ]);
  });

  it("does not step down on a non-429 failure of gemini-2.5-flash", async () => {
    geminiGenerateMock.mockRejectedValue(err400());

    const { generateText } = await import("./llm");
    await expect(
      generateText("hi", {
        task: "chat",
        provider: "gemini",
        modelOverride: { gemini: "gemini-2.5-flash" },
      }),
    ).rejects.toThrow(/All LLM providers failed/);

    expect(requestedModels).toEqual(["gemini-2.5-flash"]);
  });
});
