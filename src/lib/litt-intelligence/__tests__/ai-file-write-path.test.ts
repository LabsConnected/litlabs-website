import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleFilesWrite, handleFilesRead } from "@/lib/litt-intelligence/tool-handlers-v2";
import type { WorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";

/**
 * P0 — AI Build → Static Preview: verify the REAL AI file-write path.
 *
 * This test dispatches through the actual `handleFilesWrite` handler that
 * the agent loop invokes (not a mock of it), using a test transport that
 * writes to a temp directory. It proves:
 * 1. The registered handler accepts agent-style inputs and writes files.
 * 2. Path validation rejects traversal (the handler's own guard).
 * 3. Approval policy classifies files.write as auto-approvable in AUTO mode.
 * 4. Zero subprocesses are spawned during the write path.
 */

const childProcessSpies: Array<{ mockRestore(): void; mockClear(): void }> = [];

function spyOnChildProcess() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cp = require("node:child_process") as typeof import("node:child_process");
  for (const m of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const) {
    childProcessSpies.push(vi.spyOn(cp, m) as unknown as { mockRestore(): void; mockClear(): void });
  }
}

function assertZeroSubprocesses() {
  for (const spy of childProcessSpies) {
    expect(spy, `child_process.${String((spy as unknown as { getMockName?: () => string }).getMockName?.() ?? "?")} must not be called`).not.toHaveBeenCalled();
  }
}

/** Minimal WorkspaceTransport backed by a temp dir — no HTTP, no subprocess. */
function makeTestTransport(root: string): WorkspaceTransport {
  const resolve = (p: string) => {
    // Mirror the production path guard: reject traversal.
    if (p.includes("..")) throw new Error("Path traversal rejected");
    return join(root, p.replace(/^\//, ""));
  };
  return {
    projectId: "proj-test",
    userId: "user-test",
    workspaceId: "ws-test",
    workspaceRoot: root,
    fileOpsReachable: true,
    probeReachable: async () => true,
    listFiles: async () => ({ entries: [] }),
    readFile: async (path: string) => {
      const { readFileSync, statSync } = await import("node:fs");
      const full = resolve(path);
      const content = readFileSync(full, "utf-8");
      return { content, size: statSync(full).size };
    },
    readBinaryFile: async () => ({ content: "", size: 0 }),
    writeFile: async (path: string, content: string) => {
      const { writeFileSync, mkdirSync } = await import("node:fs");
      const { dirname: d } = await import("node:path");
      const full = resolve(path);
      mkdirSync(d(full), { recursive: true });
      writeFileSync(full, content, "utf-8");
      return { saved: true };
    },
    writeBinaryFile: async () => ({ saved: true }),
    deleteFile: async () => ({ deleted: true }),
    mkdir: async () => {},
    rename: async () => {},
    startPreview: async () => ({ status: "failed" as const, workspaceId: "ws-test", error: "not implemented in test" }),
    getPreviewStatus: async () => ({ status: "failed" as const, workspaceId: "ws-test", logs: [] }),
    stopPreview: async () => ({ status: "stopped" as const, workspaceId: "ws-test" }),
  } as unknown as WorkspaceTransport;
}

describe("AI file-write path (real handler dispatch)", () => {
  let root: string;
  let transport: WorkspaceTransport;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ai-write-test-"));
    transport = makeTestTransport(root);
    spyOnChildProcess();
  });

  afterEach(() => {
    for (const spy of childProcessSpies) spy.mockRestore();
    childProcessSpies.length = 0;
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("dispatches files.write through the real handler and lands bytes on disk", async () => {
    const result = await handleFilesWrite(
      { path: "index.html", content: "<h1>Hello</h1>" },
      transport,
    );
    expect(result.success).toBe(true);
    expect(result.path).toBe("index.html");
    expect(existsSync(join(root, "index.html"))).toBe(true);
    expect(readFileSync(join(root, "index.html"), "utf-8")).toBe("<h1>Hello</h1>");
    assertZeroSubprocesses();
  });

  it("writes nested paths, creating directories", async () => {
    const result = await handleFilesWrite(
      { path: "assets/css/style.css", content: "body { color: red; }" },
      transport,
    );
    expect(result.success).toBe(true);
    expect(readFileSync(join(root, "assets/css/style.css"), "utf-8")).toBe("body { color: red; }");
    assertZeroSubprocesses();
  });

  it("rejects path traversal via the handler's own guard", async () => {
    const result = await handleFilesWrite(
      { path: "../evil.txt", content: "x" },
      transport,
    );
    expect(result.success).toBe(false);
    expect(existsSync(join(tmpdir(), "evil.txt"))).toBe(false);
    assertZeroSubprocesses();
  });

  it("round-trips: write then read returns identical content", async () => {
    await handleFilesWrite({ path: "app.js", content: "console.log(1);" }, transport);
    const read = await handleFilesRead({ path: "app.js" }, transport);
    expect(read.success).toBe(true);
    expect(read.content).toBe("console.log(1);");
    assertZeroSubprocesses();
  });

  it("files.write is registered in the tool registry with files:write permission", async () => {
    const mod = await import("@/lib/litt-intelligence/tool-registry");
    // The lazy handler map must contain files.write (proves registry wiring).
    const { toolRegistry, registerInternalTools } = mod;
    registerInternalTools();
    const tool = toolRegistry.get("files.write");
    expect(tool).toBeDefined();
    expect(tool?.requiredPermissions).toContain("files:write");
  });

  it("files.write is auto-approved in AUTO mode (permission engine)", async () => {
    const { PermissionEngine } = await import("@/lib/litt-intelligence/permission-engine");
    const engine = new PermissionEngine();
    const tool = {
      toolId: "files.write",
      permissionLevel: "workspace-write" as const,
      isReadOnly: false,
      isMutation: true,
      enabled: true,
      requiredCapabilities: [],
    };
    // AUTO mode: safe workspace mutations auto-approve.
    const auto = engine.check(tool, {}, "auto", []);
    expect(auto.allowed).toBe(true);
    expect(auto.requiresApproval).toBe(false);
  });

  it("files.write requires approval in ACT mode", async () => {
    const { PermissionEngine } = await import("@/lib/litt-intelligence/permission-engine");
    const engine = new PermissionEngine();
    const tool = {
      toolId: "files.write",
      permissionLevel: "workspace-write" as const,
      isReadOnly: false,
      isMutation: true,
      enabled: true,
      requiredCapabilities: [],
    };
    const act = engine.check(tool, {}, "act", []);
    expect(act.allowed).toBe(true);
    expect(act.requiresApproval).toBe(true);
  });

  it("files.write is blocked in PLAN mode (read-only only)", async () => {
    const { PermissionEngine } = await import("@/lib/litt-intelligence/permission-engine");
    const engine = new PermissionEngine();
    const tool = {
      toolId: "files.write",
      permissionLevel: "workspace-write" as const,
      isReadOnly: false,
      isMutation: true,
      enabled: true,
      requiredCapabilities: [],
    };
    const plan = engine.check(tool, {}, "plan", []);
    expect(plan.allowed).toBe(false);
  });
});

describe("handleFilesWrite — LITT-WELCOME-SCREEN scaffold exemption", () => {
  /**
   * P1 fix: the small-lane destructive-rewrite guard refused the model's
   * first files.write to index.html on every fresh project — the scaffold
   * is fully styled (sig >= 3) so the 1.5B's replacement HTML failed the
   * 40% retention floor, the approved mutation failed, and the run died
   * with "approved workspace operation failed". The scaffold's own marker
   * declares it MUST be replaced — the guard now exempts it. Real styled
   * user files still get the full guard.
   */
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "litt-ws-welcome-"));
    process.env.LITT_LOCAL_SMALL = "1";
  });
  afterEach(() => {
    delete process.env.LITT_LOCAL_SMALL;
    rmSync(root, { recursive: true, force: true });
  });

  const STYLED_SCAFFOLD = `<!-- LITT-WELCOME-SCREEN: blank-state of the LiTT builder. Not a project, not project content.
     The agent MUST replace this file with the user's real project files as soon as it starts building. -->
<!DOCTYPE html><html><head><style>
:root { color-scheme: dark; } * { box-sizing: border-box; }
body { font-family: ui-sans-serif, system-ui, sans-serif; color: #e8eef7; }
.litt-welcome { position: relative; max-width: 660px; text-align: center; }
</style></head><body><div class="litt-welcome"><h1>Welcome</h1></div></body></html>`;

  const PLAIN_USER_HTML = `<!DOCTYPE html><html><body><h1>My Site</h1><p>hello</p></body></html>`;

  it("allows a full rewrite of the welcome-screen scaffold", async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(root, "index.html"), STYLED_SCAFFOLD);
    const transport = makeTestTransport(root);
    const result = await handleFilesWrite(
      { path: "index.html", content: PLAIN_USER_HTML },
      transport,
    );
    expect(result.success).toBe(true);
    expect(readFileSync(join(root, "index.html"), "utf-8")).toBe(PLAIN_USER_HTML);
  });

  it("still refuses a destructive rewrite of a real styled user file", async () => {
    const { writeFileSync } = await import("node:fs");
    // Signature >= 3 markers so the guard engages: style-tag, class-attrs,
    // font, css-vars, semantic-layout, media-query.
    const styledUserFile = `<!DOCTYPE html><html><head><style>
:root { --accent: #0af; } body { font-family: sans-serif; }
@media (max-width: 600px) { .a { display: none; } }
</style></head><body><main class="a"><section class="b"><h1>Site</h1></section></main></body></html>`;
    writeFileSync(join(root, "index.html"), styledUserFile);
    const transport = makeTestTransport(root);
    const result = await handleFilesWrite(
      { path: "index.html", content: PLAIN_USER_HTML },
      transport,
    );
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("full-file rewrite");
    // The user's file is untouched.
    expect(readFileSync(join(root, "index.html"), "utf-8")).toBe(styledUserFile);
  });
});
