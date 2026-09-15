// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { streamText, AllProvidersEmptyError } from "./llm";

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
