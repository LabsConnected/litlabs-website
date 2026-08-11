import { beforeAll, describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Set environment variables before importing the module under test
process.env.GEMINI_API_KEY = "test-gemini-key";
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.GROQ_API_KEY = "test-groq-key";
process.env.AWS_ACCESS_KEY_ID = "test-aws-key";
process.env.AWS_SECRET_ACCESS_KEY = "test-aws-secret";

// Mock external dependencies
vi.mock("@/lib/evals/braintrust", () => ({
  logLLMCall: vi.fn(),
}));

vi.mock("@/lib/metrics", () => ({
  recordLLMCall: vi.fn(),
}));

// Mock google/generative-ai
const generateContentMock = vi.fn();
const generateContentStreamMock = vi.fn();
const getGenerativeModelMock = vi.fn(() => ({
  generateContent: generateContentMock,
  generateContentStream: generateContentStreamMock,
}));

vi.mock("@google/generative-ai", () => {
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => {
      return {
        getGenerativeModel: getGenerativeModelMock,
      };
    }),
  };
});

// Import the modules under test
import { generateText, generateJSON, streamText, DEFAULT_MODELS } from "@/lib/llm";
import { complete } from "@/lib/llm-completion";
import { OpenRouterExecutor } from "@/lib/llm-executor";
import {
  CHAT_MODELS,
  getChatModel,
  isLittAlias,
  resolveLittAlias,
  getLittAliases,
} from "@/lib/studio-models";

describe("LLM Client & Studio Models Test Suite", () => {
  const mockFetch = vi.fn();

  beforeAll(() => {
    vi.stubGlobal("fetch", mockFetch);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    generateContentMock.mockReset();
    generateContentStreamMock.mockReset();
  });

  /* ------------------------------------------------------------------ */
  /*  Studio Models Tests                                               */
  /* ------------------------------------------------------------------ */
  describe("Studio Models config", () => {
    it("identifies LiTT aliases correctly", () => {
      expect(isLittAlias("litt-fast")).toBe(true);
      expect(isLittAlias("litt-balanced")).toBe(true);
      expect(isLittAlias("litt-reasoning")).toBe(true);
      expect(isLittAlias("gemini-2.5-flash")).toBe(false);
      expect(isLittAlias("auto")).toBe(false);
    });

    it("resolves LiTT aliases correctly to apiProvider and apiModel", () => {
      const balanced = resolveLittAlias("litt-balanced");
      expect(balanced).not.toBeNull();
      expect(balanced?.apiProvider).toBe("gemini");
      expect(balanced?.apiModel).toBe("gemini-2.5-flash");

      const reasoning = resolveLittAlias("litt-reasoning");
      expect(reasoning).not.toBeNull();
      expect(reasoning?.apiProvider).toBe("openrouter-deepseek");
      expect(reasoning?.apiModel).toBe("deepseek/deepseek-chat:free");

      expect(resolveLittAlias("unknown")).toBeNull();
    });

    it("retrieves chat models and fallback defaults", () => {
      const model = getChatModel("non-existent");
      expect(model).toBeDefined();
      expect(model.id).toBe("litt-auto"); // defaults to the first model in CHAT_MODELS

      const realModel = getChatModel("gemini-2.5-flash");
      expect(realModel.id).toBe("gemini-2.5-flash");
    });

    it("lists all LiTT aliases", () => {
      const aliases = getLittAliases();
      expect(aliases.length).toBeGreaterThan(0);
      expect(aliases.every((m) => m.isLittAlias)).toBe(true);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  LLM Core generateText Tests                                        */
  /* ------------------------------------------------------------------ */
  describe("generateText", () => {
    it("successfully generates text via Gemini primary provider", async () => {
      generateContentMock.mockResolvedValue({
        response: {
          text: () => "Hello from Gemini",
          usageMetadata: {
            promptTokenCount: 15,
            candidatesTokenCount: 20,
            totalTokenCount: 35,
          },
        },
      });

      const res = await generateText("Test prompt", { provider: "gemini" });
      expect(res.text).toBe("Hello from Gemini");
      expect(res.provider).toBe("gemini");
      expect(res.usage).toEqual({
        prompt: 15,
        completion: 20,
        total: 35,
      });
      expect(res.failover).toEqual([]);
      expect(getGenerativeModelMock).toHaveBeenCalledWith({ model: DEFAULT_MODELS.gemini });
    });

    it("falls back to next provider in the chain if primary fails", async () => {
      // Mock Gemini to throw a retryable error (e.g. 429)
      const mockGeminiError = new Error("Resource exhausted");
      // Need to simulate ProviderError check or general throw
      // In generateText, dispatchProvider calls generateViaGemini which will throw
      // and cause failover to openrouter-free if the chain is "auto" (default chain for chat: gemini -> groq -> openrouter-free)
      generateContentMock.mockRejectedValue(mockGeminiError);

      // Mock fetch for OpenRouter (which is the last fallback of "auto" category)
      // Since Groq is second, we'll mock Groq to also fail with 500
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => "Internal Server Error",
        }) // Groq fails
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: "Hello from OpenRouter fallback" } }],
            usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
            model: "openrouter/free",
          }),
        }); // OpenRouter succeeds

      const res = await generateText("Test prompt", { category: "auto" });

      expect(res.text).toBe("Hello from OpenRouter fallback");
      expect(res.provider).toBe("openrouter-free");
      expect(res.failover).toContain("gemini");
      expect(res.failover).toContain("groq");
    });

    it("respects category specific chains", async () => {
      // For category: "fast", defaultChain is ["groq", "gemini", "openrouter-free"]
      // Let's make Groq succeed immediately
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "Fast response from Groq" } }],
          usage: { prompt_tokens: 8, completion_tokens: 12, total_tokens: 20 },
          model: "groq-llama-70b",
        }),
      });

      const res = await generateText("Test prompt", { category: "fast" });
      expect(res.text).toBe("Fast response from Groq");
      expect(res.provider).toBe("groq");
      expect(res.failover).toEqual([]);
    });

    it("marks provider as cooldown on 404 (model not found) and skips it", async () => {
      // Create a specific 404 error like OpenRouter or other provider
      // Mock Gemini to throw a 404-like error (which inside dispatchProvider might be wrapped or general error,
      // but let's test fetch failing with 404 for openrouter-qwen in code category)
      // Category code default chain: ["openrouter-qwen", "gemini", "openrouter-free"]

      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: async () => "Model not found",
        }) // openrouter-qwen returns 404
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: "Mistral/Qwen second attempt success" } }],
            model: "openrouter/free",
          }),
        }); // openrouter-free gets called next or gemini gets called

      // Gemini mock to also fail so it skips to openrouter-free
      generateContentMock.mockRejectedValue(new Error("Gemini fails"));

      const res1 = await generateText("Code prompt", { category: "code" });
      expect(res1.provider).toBe("openrouter-free");
      expect(res1.failover).toContain("openrouter-qwen");

      // The next call for "code" should skip openrouter-qwen entirely due to cooldown!
      vi.clearAllMocks();
      generateContentMock.mockResolvedValue({
        response: {
          text: () => "Gemini code response",
        },
      });

      const res2 = await generateText("Code prompt 2", { category: "code" });
      expect(res2.provider).toBe("gemini");
      // Verify openrouter-qwen was put in failover (cooldown skips it and adds to failover)
      expect(res2.failover).toContain("openrouter-qwen");
      // And fetch should NOT have been called for openrouter-qwen
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  generateJSON Tests                                                */
  /* ------------------------------------------------------------------ */
  describe("generateJSON", () => {
    it("successfully parses valid JSON response", async () => {
      generateContentMock.mockResolvedValue({
        response: {
          text: () => '{"success": true, "data": "yes"}',
        },
      });

      const res = await generateJSON<{ success: boolean; data: string }>("JSON prompt");
      expect(res).toEqual({ success: true, data: "yes" });
    });

    it("strips markdown code fences from JSON output", async () => {
      generateContentMock.mockResolvedValue({
        response: {
          text: () => '```json\n{"cleaned": true}\n```',
        },
      });

      const res = await generateJSON<{ cleaned: boolean }>("JSON prompt");
      expect(res).toEqual({ cleaned: true });
    });

    it("falls back to extracting JSON object if wrapped in text", async () => {
      generateContentMock.mockResolvedValue({
        response: {
          text: () => 'Here is the data: {"nested": 123} enjoy!',
        },
      });

      const res = await generateJSON<{ nested: number }>("JSON prompt");
      expect(res).toEqual({ nested: 123 });
    });

    it("throws error if no JSON object can be parsed", async () => {
      generateContentMock.mockResolvedValue({
        response: {
          text: () => "No json here whatsoever",
        },
      });

      await expect(generateJSON("JSON prompt")).rejects.toThrow("LLM did not return valid JSON");
    });
  });

  /* ------------------------------------------------------------------ */
  /*  streamText Tests                                                  */
  /* ------------------------------------------------------------------ */
  describe("streamText", () => {
    it("streams text chunk-by-chunk via Gemini", async () => {
      generateContentStreamMock.mockResolvedValue({
        stream: (async function* () {
          yield { text: () => "Hello " };
          yield { text: () => "world!" };
        })(),
      });

      const chunks: string[] = [];
      const res = await streamText("Stream prompt", (chunk) => {
        chunks.push(chunk);
      }, { provider: "gemini" });

      expect(res.provider).toBe("gemini");
      expect(chunks).toEqual(["Hello ", "world!"]);
    });

    it("streams text and extracts thoughts via Gemini 2.5 thinking shape", async () => {
      generateContentStreamMock.mockResolvedValue({
        stream: (async function* () {
          yield {
            text: () => "Answer",
            candidates: [
              {
                content: {
                  parts: [
                    { thought: true, text: "Thinking process" },
                    { text: "Answer" },
                  ],
                },
              },
            ],
          };
        })(),
      });

      const chunks: string[] = [];
      const thoughts: string[] = [];
      await streamText(
        "Thinking prompt",
        (chunk) => chunks.push(chunk),
        { provider: "gemini" },
        undefined,
        (thought) => thoughts.push(thought)
      );

      expect(chunks).toEqual(["Answer"]);
      expect(thoughts).toEqual(["Thinking process"]);
    });

    it("streams text via OpenRouter SSE protocol and reads reasoning", async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          // SSE format: data: {...}\n\n
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                choices: [{ delta: { content: "Hello ", reasoning: "Thought A" } }],
              })}\n\n`
            )
          );
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                choices: [{ delta: { content: "world" } }],
              })}\n\n`
            )
          );
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: mockStream,
      });

      const chunks: string[] = [];
      const thoughts: string[] = [];
      const res = await streamText(
        "OpenRouter stream prompt",
        (chunk) => chunks.push(chunk),
        { provider: "openrouter-free" },
        undefined,
        (thought) => thoughts.push(thought)
      );

      expect(res.provider).toBe("openrouter-free");
      expect(chunks).toEqual(["Hello ", "world"]);
      expect(thoughts).toEqual(["Thought A"]);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  llm-completion complete Tests                                     */
  /* ------------------------------------------------------------------ */
  describe("complete API", () => {
    it("routes complete calls to OpenRouter successfully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "OpenRouter response" } }],
          usage: { prompt_tokens: 10, completion_tokens: 15 },
        }),
      });

      const result = await complete({
        provider: "openrouter",
        model: "meta-llama/llama-3-8b",
        prompt: "Completion query",
      });

      expect(result.text).toBe("OpenRouter response");
      expect(result.usage).toEqual({
        prompt_tokens: 10,
        completion_tokens: 15,
      });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://openrouter.ai/api/v1/chat/completions",
        expect.any(Object)
      );
    });

    it("routes complete calls to Bedrock successfully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          outputText: "Bedrock response",
          usage: { prompt_tokens: 5, completion_tokens: 5 },
        }),
      });

      const result = await complete({
        provider: "bedrock",
        model: "anthropic.claude-v3",
        prompt: "Completion query",
      });

      expect(result.text).toBe("Bedrock response");
      expect(result.usage).toEqual({
        prompt_tokens: 5,
        completion_tokens: 5,
      });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-v3/invoke"),
        expect.any(Object)
      );
    });
  });

  /* ------------------------------------------------------------------ */
  /*  llm-executor Tests                                                */
  /* ------------------------------------------------------------------ */
  describe("LlmExecutor", () => {
    it("runs OpenRouterExecutor successfully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "Executor output" } }],
          usage: { prompt_tokens: 2, completion_tokens: 3 },
        }),
      });

      const executor = new OpenRouterExecutor();
      const res = await executor.run({
        id: "task-123",
        sessionId: "session-abc",
        input: {
          prompt: "Exec prompt",
          model: "gpt-4o-mini",
        },
      });

      expect(res.status).toBe("success");
      expect(res.taskId).toBe("task-123");
      expect(res.text).toBe("Executor output");
      expect(res.provider).toBe("openrouter");
    });

    it("handles errors gracefully in OpenRouterExecutor", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Error message",
      });

      const executor = new OpenRouterExecutor();
      const res = await executor.run({
        id: "task-failed",
        sessionId: "session-failed",
        input: {
          prompt: "Exec prompt",
        },
      });

      expect(res.status).toBe("failed");
      expect(res.taskId).toBe("task-failed");
      expect(res.text).toBe("");
      expect(res.error).toContain("OpenRouter error 500");
    });
  });
});
