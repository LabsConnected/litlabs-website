import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

// -- Mock LiTT Runtime server --
let server: Server;
let baseUrl = "";
const receivedRequests: Array<{ body: any; headers: Record<string, string[]> }> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      let body: any = {};
      try {
        body = JSON.parse(raw);
      } catch {}
      receivedRequests.push({ body, headers: req.headers as any });

      if (body.stream === true) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const events = [
          { type: "text", text: "Hello from LiTT" },
          { type: "done", provider: "gemini", model: "gemini-2.5-flash", latencyMs: 10 },
        ];
        for (const e of events) {
          res.write(`data: ${JSON.stringify(e)}\n\n`);
        }
        res.end("data: [DONE]\n\n");
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ text: "Non-stream reply", provider: "gemini", model: "x", latencyMs: 5 }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => {
  server?.close();
});

describe("cli/api-client", () => {
  it("sends agentMode cli + agentSlug litt to /api/litt/run (non-stream)", async () => {
    vi.resetModules();
    process.env.LITT_CODE_API_URL = baseUrl;
    process.env.LITT_CODE_TOKEN = "test-token-abc";
    const { runLiTT } = await import("../src/cli/api-client.js");

    const result = await runLiTT({ message: "explain this repo" });
    expect(result.response.text).toBe("Non-stream reply");

    const last = receivedRequests[receivedRequests.length - 1];
    expect(last.body.message).toBe("explain this repo");
    expect(last.body.agentMode).toBe("cli");
    expect(last.body.agentSlug).toBe("litt");
    expect(last.body.stream).toBe(false);
    expect(Array.isArray(last.body.runtimeContext)).toBe(false);
  });

  it("streams text+done events and forwards the bearer token", async () => {
    vi.resetModules();
    process.env.LITT_CODE_API_URL = baseUrl;
    process.env.LITT_CODE_TOKEN = "test-token-abc";
    const { runLiTTStream } = await import("../src/cli/api-client.js");

    const events: any[] = [];
    for await (const evt of runLiTTStream({ message: "run tests" })) {
      events.push(evt);
    }

    expect(events.length).toBeGreaterThanOrEqual(2);
    const textEvent = events.find((e) => e.type === "text" && e.text?.includes("Hello"));
    expect(textEvent?.text).toBe("Hello from LiTT");

    const last = receivedRequests[receivedRequests.length - 1];
    expect(last.body.agentMode).toBe("cli");
    expect(last.body.stream).toBe(true);
    const authHeader = last.headers.authorization as string | string[] | undefined;
    const authValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    expect(authValue).toBe("Bearer test-token-abc");

    delete process.env.LITT_CODE_API_URL;
    delete process.env.LITT_CODE_TOKEN;
  });

  it("derives requestedProvider from gemini-* model prefix", async () => {
    vi.resetModules();
    process.env.LITT_CODE_API_URL = baseUrl;
    process.env.LITT_CODE_TOKEN = "test-token-abc";
    const { runLiTT } = await import("../src/cli/api-client.js");

    await runLiTT({ message: "hi", model: "gemini-2.5-pro" });

    const last = receivedRequests[receivedRequests.length - 1];
    expect(last.body.requestedModel).toBe("gemini-2.5-pro");
    expect(last.body.requestedProvider).toBe("gemini");
  });

  it("honors an explicit provider flag alongside model", async () => {
    vi.resetModules();
    process.env.LITT_CODE_API_URL = baseUrl;
    process.env.LITT_CODE_TOKEN = "test-token-abc";
    const { runLiTT } = await import("../src/cli/api-client.js");

    await runLiTT({ message: "hi", model: "gemini-2.5-flash", provider: "gemini" });

    const last = receivedRequests[receivedRequests.length - 1];
    expect(last.body.requestedModel).toBe("gemini-2.5-flash");
    expect(last.body.requestedProvider).toBe("gemini");
  });

  it("omits requestedProvider for unknown model prefixes", async () => {
    vi.resetModules();
    process.env.LITT_CODE_API_URL = baseUrl;
    process.env.LITT_CODE_TOKEN = "test-token-abc";
    const { runLiTT } = await import("../src/cli/api-client.js");

    await runLiTT({ message: "hi", model: "gpt-4o" });

    const last = receivedRequests[receivedRequests.length - 1];
    expect(last.body.requestedModel).toBe("gpt-4o");
    expect(last.body.requestedProvider).toBeUndefined();

    delete process.env.LITT_CODE_API_URL;
    delete process.env.LITT_CODE_TOKEN;
  });
});
