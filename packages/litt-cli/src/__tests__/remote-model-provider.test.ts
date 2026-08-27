import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteModelProvider } from "../lib/remote-model-provider.js";
import type { RuntimeClient } from "../lib/runtime-client.js";

afterEach(() => {
  delete process.env.LITT_MAX_TOKENS;
});

function clientThatRecordsOptions() {
  const streamModel = vi.fn(async (
    _requestId: string,
    model: string,
    _messages: unknown[],
    _tools: unknown[],
    onEvent: (event: { type: "done"; model: string; usage: { total_tokens: number } }) => void,
  ) => {
    onEvent({ type: "done", model, usage: { total_tokens: 0 } });
    return { provider: "openai", model, usage: { total_tokens: 0 } };
  });

  return {
    client: { streamModel } as unknown as RuntimeClient,
    streamModel,
  };
}

describe("RemoteModelProvider max token policy", () => {
  it("always sends the canonical bounded default", async () => {
    const { client, streamModel } = clientThatRecordsOptions();
    const provider = new RemoteModelProvider({ client, model: "gpt-test" });

    await provider.stream([{ role: "user", content: "hello" }], () => {});

    expect(streamModel.mock.calls[0]?.[5]).toMatchObject({ maxTokens: 3000 });
  });

  it("preserves an explicit caller value", async () => {
    const { client, streamModel } = clientThatRecordsOptions();
    const provider = new RemoteModelProvider({
      client,
      model: "gpt-test",
      maxTokens: 1200,
    });

    await provider.stream([{ role: "user", content: "hello" }], () => {});

    expect(streamModel.mock.calls[0]?.[5]).toMatchObject({ maxTokens: 1200 });
  });
});
