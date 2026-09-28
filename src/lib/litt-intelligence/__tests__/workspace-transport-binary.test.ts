import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Binary-read contract for WorkspaceTransport.readBinaryFile.
 *
 * Production regression (22P05 "unsupported Unicode escape sequence"):
 * the deploy collector asked the terminal for base64, an older terminal
 * build ignored `encoding` and returned a utf-8 decode of JPEG bytes —
 * NULs and replacement chars — which was stored as if it were base64 and
 * blew up the Postgres insert. The transport must refuse a response that
 * does not prove the encoding was honored.
 */

vi.mock("@/lib/projects/project-repository", () => ({
  verifyProjectWorkspace: vi.fn(async () => ({
    workspaceId: "ws_test",
    workspaceRoot: "/data/ws_test",
  })),
}));
vi.mock("@/lib/terminal-auth", () => ({
  createTerminalToken: vi.fn(() => ({ token: "t", expiresAt: Date.now() + 60_000 })),
}));
vi.mock("@/lib/terminal-url", () => ({
  getTerminalServerUrl: vi.fn(() => "https://terminal.test"),
}));

import { createWorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";

const realFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * createWorkspaceTransport() probes GET /ws-files?path=. at creation
 * (reachability). Route the stub by URL so the probe gets a listing and
 * the read tests get their canned response; assertions target the
 * /ws-files/read call, never mock.calls[0].
 */
function stubFetch(readBody: unknown) {
  globalThis.fetch = vi.fn(async (url: unknown) => {
    if (String(url).includes("/ws-files/read")) return jsonResponse(readBody);
    return jsonResponse({ entries: [] });
  }) as unknown as typeof fetch;
}

function readCallInit(): RequestInit {
  const calls = vi.mocked(globalThis.fetch).mock.calls as unknown as Array<
    [string, RequestInit | undefined]
  >;
  const found = calls.find(([url]) => String(url).includes("/ws-files/read"));
  if (!found || !found[1]) throw new Error("no /ws-files/read call was made");
  return found[1];
}

async function makeTransport() {
  return createWorkspaceTransport("proj_test", "user_test");
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("readBinaryFile encoding contract", () => {
  it("returns content when the terminal honors base64", async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    stubFetch({ content: bytes.toString("base64"), size: bytes.length, encoding: "base64" });

    const transport = await makeTransport();
    const result = await transport.readBinaryFile("assets/x.jpeg");
    expect(result.content).toBe(bytes.toString("base64"));

    // The request actually asked for base64.
    expect(JSON.parse(String(readCallInit().body))).toMatchObject({ path: "assets/x.jpeg", encoding: "base64" });
  });

  it("rejects a response that never applied base64 (old terminal build)", async () => {
    // Old terminal ignores `encoding` and returns a utf-8 decode — no
    // `encoding` field, and the content contains NULs/replacement chars.
    const utf8Jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString("utf-8");
    stubFetch({ content: utf8Jpeg, size: 6 });

    const transport = await makeTransport();
    await expect(transport.readBinaryFile("assets/x.jpeg")).rejects.toThrow(/base64/i);
  });

  it("rejects a claimed-base64 response whose content is not base64", async () => {
    stubFetch({ content: "ÿØÿà corrupted", size: 6, encoding: "base64" });

    const transport = await makeTransport();
    await expect(transport.readBinaryFile("assets/x.jpeg")).rejects.toThrow(/base64/i);
  });

  it("utf-8 reads are unaffected by the contract check", async () => {
    stubFetch({ content: "<p>émoji 🐶 日本語</p>", size: 20, encoding: "utf-8" });

    const transport = await makeTransport();
    const result = await transport.readFile("index.html");
    expect(result.content).toBe("<p>émoji 🐶 日本語</p>");
  });
});
