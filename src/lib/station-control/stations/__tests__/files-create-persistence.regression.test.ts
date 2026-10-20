// @vitest-environment node
/**
 * Regression — files.create must persist the content it is given.
 *
 * Defect (staging run 00808832 on dc7b9d91, ART-20261020-027): the agent's
 * files.create calls reported success while the workspace never changed —
 * index.html kept its starter scaffolding and the workspace manifest
 * enumerated exactly one document for the whole run, while files.mkdir
 * through the same transport DID persist (the discriminating asymmetry).
 *
 * Root cause proven by this harness: the files station's `files.create`
 * action schema carries {path, type} only — no `content`. The station
 * executor zod-parses the model's args (stripping `content` if sent), and
 * the action body delegates to files.write with a HARDCODED content: "",
 * so the persisted artifact is an empty file while the result reports
 * {success: true, bytesWritten: 0}. The model's intended file content is
 * silently discarded at the station seam.
 *
 * This test drives the REAL chain — executeStationAction → files station
 * execute → delegateToTool → toolRegistry files.write handler → real
 * WorkspaceTransport — with only the terminal server replaced by a
 * faithful in-process double (same /ws-files semantics as
 * terminal-server/server.ts, backed by a real temp-dir filesystem), then
 * enumerates the workspace the way the preview manifest does.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/* ── Workspace verification: stubbed DB, real transport ────────────── */
let wsRoot = "";
vi.mock("@/lib/projects/project-repository", () => ({
  verifyProjectWorkspace: vi.fn(async () => ({
    workspaceId: "ws-test",
    workspaceRoot: wsRoot,
    project: { name: "test-project", framework: "static" },
  })),
}));

/* ── Action-runtime durability: in-memory stand-in for the Supabase
 * run-store. This is the one infrastructure seam stubbed (in production
 * it is a configured Supabase admin client); every seam the defect lives
 * in — station schema/executor, delegate, registry, handler, transport,
 * terminal — runs real code. ──────────────────────────────────────── */
vi.mock("@/lib/action-runtime/run-store", () => {
  const makeRun = (id: string, userId: string) => ({
    id,
    userId,
    projectId: "proj_1",
    conversationId: "conv_1",
    kind: "tool",
    status: "working",
    createdAt: new Date(0).toISOString(),
    startedAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    completedAt: null,
    currentActivity: null,
    browserSessionId: null,
    cancellationRequestedAt: null,
    approvalReference: null,
    failureCode: null,
    failureMessage: null,
  });
  const event = (runId: string, userId: string, type: string) => ({
    id: "evt_1",
    sequence: "1",
    runId,
    userId,
    type,
    createdAt: new Date(0).toISOString(),
    payload: {},
  });
  return {
    createActionRun: vi.fn(async (input: { userId: string }) => makeRun("run_1", input.userId)),
    findOrCreateBrowserActionRun: vi.fn(async (input: { userId: string }) => makeRun("run_1", input.userId)),
    getActionRun: vi.fn(async (runId: string, userId: string) => makeRun(runId, userId)),
    listActionRuns: vi.fn(async () => []),
    patchActionRun: vi.fn(async (runId: string, userId: string) => makeRun(runId, userId)),
    transitionActionRun: vi.fn(async (runId: string, userId: string) => makeRun(runId, userId)),
    findActiveActionRunForConversation: vi.fn(async () => null),
    findActiveActionRunForRequest: vi.fn(async () => null),
    listActionRunsForBrowserSessions: vi.fn(async () => []),
    getActionRunByBrowserSession: vi.fn(async () => null),
    transitionActionRunEventActivity: vi.fn(
      async (input: { runId: string; userId: string }) => makeRun(input.runId, input.userId),
    ),
    attachBrowserSessionToRun: vi.fn(
      async (runId: string, userId: string) => makeRun(runId, userId),
    ),
    appendActionEvent: vi.fn(
      async (input: { runId: string; userId: string; type: string }) =>
        event(input.runId, input.userId, input.type),
    ),
    recordActionEventActivity: vi.fn(
      async (input: { runId: string; userId: string }) => makeRun(input.runId, input.userId),
    ),
    recordActionActivity: vi.fn(async (runId: string, userId: string, message: string) => ({
      id: "evt_1",
      runId,
      userId,
      message,
      createdAt: new Date(0).toISOString(),
      eventId: "evt_1",
      sequence: "1",
    })),
    listActionEvents: vi.fn(async () => []),
    requestActionRunCancellation: vi.fn(
      async (runId: string, userId: string) => makeRun(runId, userId),
    ),
  };
});

/* ── Faithful terminal double for POST/GET /ws-files* ──────────────── */
function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function resolveInWorkspace(root: string, rel: string): string {
  const target = join(root, rel);
  if (target !== root && !target.startsWith(root + "/")) {
    throw new Error("Path escapes workspace");
  }
  return target;
}

function makeTerminalFetch(root: string) {
  return vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};

    if (method === "GET" && path === "/ws-files") {
      const dirRel = String(url.searchParams.get("path") || ".");
      const target = resolveInWorkspace(root, dirRel === "." ? "" : dirRel);
      const { readdirSync } = await import("node:fs");
      const entries = readdirSync(target, { withFileTypes: true })
        .filter((e) => e.name !== ".litt")
        .map((e) => ({ name: e.name, type: e.isDirectory() ? "folder" : "file" }));
      return jsonResponse(200, { entries, workspaceId: "ws-test" });
    }
    if (method === "POST" && path === "/ws-files/write") {
      const filePath = String(body.path || "");
      const content = String(body.content || "");
      if (filePath === "fail-write.txt") {
        // Terminal-side failure: the write does NOT persist.
        return jsonResponse(500, { error: "simulated terminal write failure" });
      }
      if (!filePath || filePath === ".") {
        return jsonResponse(400, { error: "Refusing to write to workspace root" });
      }
      const target = resolveInWorkspace(root, filePath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, "utf-8");
      return jsonResponse(200, { saved: true, workspaceId: "ws-test" });
    }
    if (method === "POST" && path === "/ws-files/mkdir") {
      const filePath = String(body.path || "");
      const target = resolveInWorkspace(root, filePath);
      if (existsSync(target)) {
        return jsonResponse(409, { error: "Path already exists" });
      }
      mkdirSync(target, { recursive: false });
      return jsonResponse(200, { created: true, workspaceId: "ws-test" });
    }
    if (method === "POST" && path === "/ws-files/read") {
      const filePath = String(body.path || "");
      const target = resolveInWorkspace(root, filePath);
      const { statSync } = await import("node:fs");
      try {
        const stats = statSync(target);
        if (!stats.isFile()) return jsonResponse(400, { error: "Not a file" });
        const raw = readFileSync(target);
        return jsonResponse(200, {
          content: raw.toString("utf-8"),
          size: stats.size,
          encoding: "utf-8",
          workspaceId: "ws-test",
        });
      } catch {
        return jsonResponse(404, { error: "File not found" });
      }
    }
    return jsonResponse(404, { error: `terminal double: unhandled ${method} ${path}` });
  });
}

/* ── Fixtures ──────────────────────────────────────────────────────── */
const SCAFFOLDING = [
  "<!doctype html>",
  "<!-- LITT-WELCOME-SCREEN: blank-state of the LiTT builder. The agent MUST",
  "     replace this file with the user's real project files. -->",
  "<html><head><title>LiTT Studio — New Project</title></head>",
  "<body>Welcome to LiTT — your AI workspace is ready.</body></html>",
].join("\n");

const HARBOR_HTML = [
  "<!doctype html>",
  "<html><head><title>Harbor Coffee</title></head>",
  "<body><h1>Harbor Coffee</h1><p>Espresso $3.50 · Cappuccino $4.75</p></body></html>",
].join("\n");

type StationCtx = import("../../types").StationExecutionContext;
type StationResultT = import("../../types").StationResult;

describe("files.create persistence (regression)", () => {
  let executeStationAction: typeof import("../../executor").executeStationAction;
  let createWorkspaceTransport: typeof import("@/lib/litt-intelligence/workspace-transport").createWorkspaceTransport;
  let transport: Awaited<ReturnType<typeof createWorkspaceTransport>>;
  const realFetch = globalThis.fetch;

  function makeCtx(): StationCtx {
    return {
      projectId: "proj_1",
      conversationId: "conv_1",
      userId: "user_1",
      permissions: {
        files: "allow",
        terminal: "allow",
        browser: "allow",
        git: "allow",
        create: "allow",
        preview: "allow",
        deploy: "allow",
        production: "allow",
        payments: "deny",
        externalPost: "deny",
        secrets: "deny",
      },
      emitEvent: () => {},
      navigateToStation: () => {},
      reportLiveState: () => {},
      transport,
      actionContext: { userId: "user_1", projectId: "proj_1", actionRunId: "run_1" },
    } as StationCtx;
  }

  beforeAll(async () => {
    wsRoot = mkdtempSync(join(tmpdir(), "litt-ws-create-"));
    writeFileSync(join(wsRoot, "index.html"), SCAFFOLDING, "utf-8");
    mkdirSync(join(wsRoot, "assets"), { recursive: true });

    process.env.TERMINAL_AUTH_SECRET = "test-secret-".padEnd(48, "x");
    process.env.TERMINAL_PUBLIC_URL = "http://terminal.test";
    globalThis.fetch = makeTerminalFetch(wsRoot) as unknown as typeof fetch;

    await import("../files"); // registers the files station actions
    ({ executeStationAction } = await import("../../executor"));
    ({ createWorkspaceTransport } = await import(
      "@/lib/litt-intelligence/workspace-transport"
    ));
    transport = await createWorkspaceTransport("proj_1", "user_1");
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    rmSync(wsRoot, { recursive: true, force: true });
  });

  it("create on an EXISTING path with content persists that content", async () => {
    const result: StationResultT = await executeStationAction(
      "files.create",
      { path: "index.html", type: "file", content: HARBOR_HTML },
      makeCtx(),
    );
    expect(result.success).toBe(true);
    // The truth condition: what the agent was told (success) must match
    // what is on disk. On dc7b9d91 this fails — disk holds "" because the
    // station schema strips `content` and the adapter hardcodes "".
    expect(readFileSync(join(wsRoot, "index.html"), "utf-8")).toBe(HARBOR_HTML);
    const nested = (result as { result?: { bytesWritten?: number } }).result;
    expect(nested?.bytesWritten).toBe(Buffer.byteLength(HARBOR_HTML, "utf-8"));
  });

  it("create on a NEW path with content persists it and enumeration sees it", async () => {
    const result: StationResultT = await executeStationAction(
      "files.create",
      { path: "menu.html", type: "file", content: "<html>menu</html>" },
      makeCtx(),
    );
    expect(result.success).toBe(true);
    expect(readFileSync(join(wsRoot, "menu.html"), "utf-8")).toBe("<html>menu</html>");
    const { entries } = await transport.listFiles(".");
    expect(entries.map((e) => e.name)).toContain("menu.html");
  });

  it("create without content still makes an empty file (documented contract)", async () => {
    const result: StationResultT = await executeStationAction(
      "files.create",
      { path: "empty.txt", type: "file" },
      makeCtx(),
    );
    expect(result.success).toBe(true);
    expect(existsSync(join(wsRoot, "empty.txt"))).toBe(true);
    expect(readFileSync(join(wsRoot, "empty.txt"), "utf-8")).toBe("");
  });

  it("a terminal write failure is reported honestly, never as success", async () => {
    const result: StationResultT = await executeStationAction(
      "files.create",
      { path: "fail-write.txt", type: "file", content: "x" },
      makeCtx(),
    );
    // On dc7b9d91 this fails: delegateToTool maps the settled registry
    // outcome to {success:true} even when the nested files.write result
    // is {success:false}, so the failure is masked and nothing persisted
    // while the agent is told the create succeeded.
    expect(result.success).toBe(false);
    expect(existsSync(join(wsRoot, "fail-write.txt"))).toBe(false);
  });

  it("create type=dir persists a directory (the mkdir asymmetry)", async () => {
    const result: StationResultT = await executeStationAction(
      "files.create",
      { path: "assets/images", type: "dir" },
      makeCtx(),
    );
    expect(result.success).toBe(true);
    expect(existsSync(join(wsRoot, "assets/images"))).toBe(true);
  });
});
