import { describe, it, expect, vi, beforeEach } from "vitest";
import { inflateRawSync } from "zlib";
import { GET } from "./route";

/**
 * Studio project ZIP export — route-level tests.
 * Terminal-server calls are stubbed at global fetch; the archive itself is
 * parsed back (central directory → inflate) to prove real ZIP integrity.
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/projects/project-repository", () => ({
  verifyProjectWorkspace: vi.fn(),
}));
vi.mock("@/lib/terminal-auth", () => ({
  createTerminalToken: vi.fn(() => ({ token: "test-token", expiresAt: Date.now() + 60_000 })),
}));
vi.mock("@/lib/terminal-config", () => ({
  requireTerminalBaseUrl: vi.fn(() => "https://terminal.test"),
  terminalNotConfiguredResponse: vi.fn(() => null),
}));
vi.mock("@/lib/studio/workspace-recovery", () => ({
  ensureWorkspaceAlive: vi.fn(),
  reprepareWorkspace: vi.fn(),
  normalizeFileError: vi.fn((m: string) => m),
}));

import { auth } from "@/lib/auth";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";

const authMock = vi.mocked(auth);
const verifyMock = vi.mocked(verifyProjectWorkspace);

function makeParams() {
  return { params: Promise.resolve({ projectId: "proj-1" }) };
}

function listResponse(entries: Array<{ name: string; type: string }>) {
  return new Response(JSON.stringify({ entries }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function readResponse(data: Buffer) {
  return new Response(
    JSON.stringify({ content: data.toString("base64"), size: data.length, encoding: "base64" }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** Parse a ZIP's central directory and inflate every entry. */
function unzip(buf: Buffer): Map<string, Buffer> {
  // Find EOCD (last 22 bytes minimum).
  const eocdAt = buf.lastIndexOf(0x06054b50);
  expect(eocdAt).toBeGreaterThan(-1);
  const count = buf.readUInt16LE(eocdAt + 10);
  let ptr = buf.readUInt32LE(eocdAt + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(ptr)).toBe(0x02014b50);
    const method = buf.readUInt16LE(ptr + 10);
    const compressed = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localAt = buf.readUInt32LE(ptr + 42);
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf-8");
    // Local header: data starts after 30 + name + extra.
    const lNameLen = buf.readUInt16LE(localAt + 26);
    const lExtraLen = buf.readUInt16LE(localAt + 28);
    const dataStart = localAt + 30 + lNameLen + lExtraLen;
    const stored = buf.subarray(dataStart, dataStart + compressed);
    out.set(name, method === 8 ? inflateRawSync(stored) : stored);
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe("studio-projects export route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user-1", clerkId: "user-1" });
    verifyMock.mockResolvedValue({
      project: { id: "proj-1", name: "My Site" } as never,
      workspaceId: "ws-1",
      workspaceRoot: "/tmp/ws-1",
    });
  });

  it("rejects unauthenticated requests", async () => {
    authMock.mockResolvedValue({ userId: null, clerkId: null });
    const res = await GET(new Request("http://x/export") as never, makeParams());
    expect(res.status).toBe(401);
  });

  it("packs workspace files into a valid ZIP", async () => {
    const files: Record<string, string> = {
      "index.html": "<html><body>hello</body></html>",
      "css/style.css": "body { color: rebeccapurple; }",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/ws-files/read")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { path: string };
        return readResponse(Buffer.from(files[body.path] ?? "", "utf-8"));
      }
      if (url.includes("path=css")) return listResponse([{ name: "style.css", type: "file" }]);
      return listResponse([
        { name: "index.html", type: "file" },
        { name: "css", type: "folder" },
        { name: "node_modules", type: "folder" },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(new Request("http://x/export") as never, makeParams());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toContain("my-site-export.zip");

    const zip = Buffer.from(await res.arrayBuffer());
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    const entries = unzip(zip);
    expect(entries.get("index.html")?.toString()).toBe(files["index.html"]);
    expect(entries.get("css/style.css")?.toString()).toBe(files["css/style.css"]);
    // node_modules is environment state — excluded.
    expect([...entries.keys()].some((n) => n.startsWith("node_modules"))).toBe(false);
    vi.unstubAllGlobals();
  });

  it("manifests unreadable files instead of dropping them silently", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/ws-files/read")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { path: string };
        if (body.path === "big.bin") {
          return new Response(JSON.stringify({ error: "File exceeds max read size" }), { status: 413 });
        }
        return readResponse(Buffer.from("ok", "utf-8"));
      }
      return listResponse([
        { name: "index.html", type: "file" },
        { name: "big.bin", type: "file" },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(new Request("http://x/export") as never, makeParams());
    expect(res.status).toBe(200);
    const entries = unzip(Buffer.from(await res.arrayBuffer()));
    expect(entries.get("index.html")?.toString()).toBe("ok");
    const manifest = entries.get("EXPORT-SKIPPED.txt")?.toString();
    expect(manifest).toContain("big.bin");
    expect(res.headers.get("x-export-skipped")).toBe("1");
    vi.unstubAllGlobals();
  });

  it("409s when the workspace has no files", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => listResponse([])));
    const res = await GET(new Request("http://x/export") as never, makeParams());
    expect(res.status).toBe(409);
    vi.unstubAllGlobals();
  });
});
