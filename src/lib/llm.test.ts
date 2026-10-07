// @vitest-environment node
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { streamText, AllProvidersEmptyError } from "./llm";
import type { ModelCategory } from "./llm";

/**
 * Provider-level abort coverage — proves an explicit execution abort
 * reaches the REAL provider operation (the fetch's AbortSignal and the
 * response stream reader), not just the caller's await. This is what
 * makes V1 Stop true cancellation rather than a detached Promise.race.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("streamText — provider abort propagation", () => {
  it("does not start any provider request when the signal is already aborted", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const ctrl = new AbortController();
    ctrl.abort(new Error("Cancelled by user"));

    await expect(
      streamText("hi", () => {}, {
        task: "chat",
        provider: "groq",
        signal: ctrl.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts the in-flight provider fetch while the request is pending", async () => {
    let capturedFetchSignal: AbortSignal | undefined;
    const fetchMock = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          capturedFetchSignal = init?.signal ?? undefined;
          // Real fetch rejects with AbortError when its signal aborts.
          init?.signal?.addEventListener(
            "abort",
            () =>
              reject(
                init.signal?.reason instanceof Error
                  ? init.signal.reason
                  : new DOMException("The operation was aborted.", "AbortError"),
              ),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const ctrl = new AbortController();
    const pending = streamText(
      "hi",
      () => {},
      { task: "chat", provider: "groq", signal: ctrl.signal },
    );

    // Wait for the provider fetch to be issued, then abort the execution.
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    ctrl.abort(new Error("Cancelled by user"));

    // The run rejects with the abort — streamText must not swallow it or
    // retry another provider once the execution signal has fired.
    await expect(pending).rejects.toThrow("Cancelled by user");

    // The external execution abort propagated into the actual fetch's
    // AbortSignal — the underlying provider request really stopped.
    expect(capturedFetchSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancels the provider response stream reader when aborted mid-read", async () => {
    let readerCancelled = false;
    const fetchMock = vi.fn(async () => {
      // A streaming body that never completes on its own — the reader
      // must be cancelled for the loop to exit.
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          readerCancelled = true;
        },
      });
      return new Response(body);
    });
    vi.stubGlobal("fetch", fetchMock);

    const ctrl = new AbortController();
    const chunks: string[] = [];
    const pending = streamText(
      "hi",
      (c) => chunks.push(c),
      { task: "chat", provider: "groq", signal: ctrl.signal },
    );

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    ctrl.abort(new Error("Cancelled by user"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    // The response stream reader was torn down — token/cost consumption
    // stops, not just the local wait.
    expect(readerCancelled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("an abort during streaming does not fail over to another provider", async () => {
    // Pin a multi-provider chain via litt-alias preference; the abort on
    // the first provider must surface immediately rather than retrying.
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      init?.signal?.addEventListener(
        "abort",
        () => {
          // emulate fetch rejecting on abort, like the real implementation
        },
        { once: true },
      );
      const body = new ReadableStream<Uint8Array>({});
      return new Response(body);
    });
    vi.stubGlobal("fetch", fetchMock);

    const ctrl = new AbortController();
    const pending = streamText(
      "hi",
      () => {},
      {
        task: "chat",
        provider: "groq",
        category: "litt-alias",
        signal: ctrl.signal,
      },
    );

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    ctrl.abort(new Error("Cancelled by user"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    // groq aborted → NO fallback to gemini/openrouter.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("streamText — empty provider responses", () => {
  /** OpenAI-compatible SSE body: role-only delta, then DONE — no content. */
  const emptySse = () =>
    new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    );
  const contentSse = (text: string) =>
    new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    );

  it("an empty stream from the only provider rejects as EMPTY_PROVIDER_RESPONSE, not a silent success", async () => {
    const fetchMock = vi.fn(async () => emptySse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      streamText("hi", () => {}, { task: "chat", provider: "groq" }),
    ).rejects.toMatchObject({ code: "EMPTY_PROVIDER_RESPONSE" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("an empty stream fails over — the next provider's real content is used", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("api.groq.com")) return emptySse();
      if (u.includes("generativelanguage")) {
        // Gemini runs through the SDK over the same stubbed fetch — a 500
        // there is a normal provider failure continuing the chain.
        return new Response("unavailable", { status: 500 });
      }
      return contentSse("real answer");
    });
    vi.stubGlobal("fetch", fetchMock);

    const chunks: string[] = [];
    const result = await streamText(
      "hi",
      (c) => chunks.push(c),
      { task: "chat", provider: "groq", category: "litt-alias" },
    );

    expect(chunks.join("")).toBe("real answer");
    expect(result.provider).toBe("openrouter-free");
    expect(result.failover).toContain("groq");
  });

  it("when every attempted provider returns an empty stream the aggregate error names what was tried", async () => {
    const fetchMock = vi.fn(async () => emptySse());
    vi.stubGlobal("fetch", fetchMock);

    const err = await streamText("hi", () => {}, {
      task: "chat",
      provider: "groq",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(AllProvidersEmptyError);
    expect(err.providers).toEqual(["groq"]);
    expect(err.message).toMatch(/empty responses/i);
  });
});

/**
 * P0 regression: entitled empty-provider-chain fallback.
 *
 * When the Studio model picker pins `provider: "gemini"` (category != "auto")
 * and GEMINI_DISABLED=true filters gemini out, the entitled-user branch of
 * defaultChain previously returned an EMPTY chain — zero provider attempts,
 * so the managed OpenAI fallback never fired. The fix drops the unhonorable
 * pin and routes through the full entitled chain (incl. LITT_PAID).
 *
 * These tests drive the PUBLIC generateText so the real defaultChain →
 * provider dispatch all execute; only the network boundary (fetch) is
 * mocked. llm.ts reads OPENAI_API_KEY once at module load, so the module
 * is re-imported under the stubbed env.
 */
describe("generateText — entitled pinned-provider-filtered-out fallback", () => {
  const OPENAI_HOST = "api.openai.com";

  function stubProviderFetch() {
    const fetchMock = vi.fn(async (url: unknown, _init?: RequestInit) => {
      if (String(url).includes(OPENAI_HOST)) {
        return new Response(
          JSON.stringify({
            id: "chatcmpl-test-1",
            object: "chat.completion",
            created: 1,
            model: "gpt-4o",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "hello world" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      // Every free provider is down for this test.
      return new Response("upstream error", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  async function loadLlmUnderTestEnv() {
    vi.resetModules();
    return await import("./llm");
  }

  beforeEach(() => {
    vi.stubEnv("GEMINI_DISABLED", "true");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("entitled + pin filtered out → managed OpenAI is attempted (not zero attempts)", async () => {
    const fetchMock = stubProviderFetch();
    const { generateText } = await loadLlmUnderTestEnv();

    const result = await generateText("hello", {
      task: "chat",
      provider: "gemini", // Studio picker pin (persisted gemini-2.5-flash)
      category: "advanced" as ModelCategory, // non-"auto", so the pin passes through (route casts body.category the same way)
      allowLittPaidProviders: true, // owner / premium entitlement
    });

    expect(result.provider).toBe("openai");
    expect(result.text).toBe("hello world");
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes(OPENAI_HOST))).toBe(true);
  });

  it("unentitled → paid route is never attempted (negative control)", async () => {
    const fetchMock = stubProviderFetch();
    const { generateText } = await loadLlmUnderTestEnv();

    await expect(
      generateText("hello", {
        task: "chat",
        provider: "gemini",
        category: "advanced" as ModelCategory,
        allowLittPaidProviders: false,
      }),
    ).rejects.toThrow(/All LLM providers failed/);

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes(OPENAI_HOST))).toBe(false);
  });
});

describe("streamText — Groq → Gemini fallback chain", () => {
  const groqSse = (text: string) =>
    new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    );
  const groq429 = () =>
    new Response(
      JSON.stringify({ error: { message: "Rate limit reached" } }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  const groq500 = () =>
    new Response("Internal Server Error", { status: 500 });
  const groq401 = () =>
    new Response(
      JSON.stringify({ error: { message: "Invalid API key" } }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  // Gemini uses the SDK which calls generativelanguage.googleapis.com
  const geminiSse = (text: string) =>
    new Response(
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`,
      { headers: { "Content-Type": "text/event-stream" } },
    );

  it("1. Groq success → Gemini never called", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("api.groq.com")) return groqSse("groq answer");
      // Gemini should never be called
      throw new Error(`Unexpected call to ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const chunks: string[] = [];
    const result = await streamText("hi", (c) => chunks.push(c), {
      task: "chat",
      provider: "groq",
      category: "litt-alias",
    });

    expect(chunks.join("")).toBe("groq answer");
    expect(result.provider).toBe("groq");
    expect(result.failover).not.toContain("gemini");
    // Verify Gemini endpoint was never hit
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("generativelanguage"))).toBe(false);
  });

  it("2. Groq 429 before first token → Gemini succeeds", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("api.groq.com")) return groq429();
      if (u.includes("generativelanguage")) return geminiSse("gemini fallback answer");
      return groqSse("unexpected");
    });
    vi.stubGlobal("fetch", fetchMock);

    const chunks: string[] = [];
    const result = await streamText("hi", (c) => chunks.push(c), {
      task: "chat",
      provider: "groq",
      category: "litt-alias",
    });

    expect(chunks.join("")).toBe("gemini fallback answer");
    expect(result.provider).toBe("gemini");
    expect(result.failover).toContain("groq");
  });

  it("3. Groq 500 → Gemini succeeds", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("api.groq.com")) return groq500();
      if (u.includes("generativelanguage")) return geminiSse("gemini after 500");
      return groqSse("unexpected");
    });
    vi.stubGlobal("fetch", fetchMock);

    const chunks: string[] = [];
    const result = await streamText("hi", (c) => chunks.push(c), {
      task: "chat",
      provider: "groq",
      category: "litt-alias",
    });

    expect(chunks.join("")).toBe("gemini after 500");
    expect(result.provider).toBe("gemini");
  });

  it("4. Groq 401 auth failure → fallback to Gemini (different provider)", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("api.groq.com")) return groq401();
      if (u.includes("generativelanguage")) return geminiSse("gemini after groq auth fail");
      return groqSse("unexpected");
    });
    vi.stubGlobal("fetch", fetchMock);

    const chunks: string[] = [];
    const result = await streamText("hi", (c) => chunks.push(c), {
      task: "chat",
      provider: "groq",
      category: "litt-alias",
    });

    // AUTH on Groq should fallback to Gemini (different provider with independent credentials)
    expect(chunks.join("")).toBe("gemini after groq auth fail");
    expect(result.provider).toBe("gemini");
    expect(result.failover).toContain("groq");
  });

  it("6. Both providers fail → one clean classified final error", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("api.groq.com")) return groq429();
      if (u.includes("generativelanguage")) return groq500(); // Gemini also fails
      return groqSse("unexpected");
    });
    vi.stubGlobal("fetch", fetchMock);

    // Both providers fail — should throw (either the aggregate error or the last provider error)
    await expect(
      streamText("hi", () => {}, {
        task: "chat",
        provider: "groq",
        category: "litt-alias",
      }),
    ).rejects.toThrow();
  });
});

describe("streamText — partial stream safety", () => {
  it("5. Groq partial-stream failure → no fallback, no duplicated answer", async () => {
    // Groq streams partial content, then fails mid-stream.
    // The router must NOT fallback to Gemini (would concatenate).
    let groqCallCount = 0;
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("api.groq.com")) {
        groqCallCount++;
        // Return a stream that emits partial content then errors
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({ choices: [{ delta: { content: "partial " } }] })}\n\n`
              )
            );
            // Then fail the stream
            controller.error(new Error("Stream interrupted"));
          },
        });
        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      // Gemini should NEVER be called after partial output
      throw new Error(`Gemini must not be called after partial stream, but got ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const chunks: string[] = [];
    // Should throw (not fallback) because partial output was already emitted
    await expect(
      streamText("hi", (c) => chunks.push(c), {
        task: "chat",
        provider: "groq",
        category: "litt-alias",
      }),
    ).rejects.toThrow();

    // Partial content was emitted but no Gemini fallback occurred
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("generativelanguage"))).toBe(false);
    // No duplication: Gemini was never called, so chunks contain only what Groq emitted
    // (the exact content depends on stream timing; the critical guarantee is no fallback)
  });
});
