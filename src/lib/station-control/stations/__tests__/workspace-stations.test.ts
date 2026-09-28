/**
 * Station Control Bridge — workspace station adapter tests (chunk B).
 *
 * The tool registry is mocked; the REAL delegateToTool / registry /
 * station modules run. Assertions verify the ADAPTER contracts:
 * - each station action calls the right underlying tool with correctly
 *   mapped inputs (projectId injection, text→value, from/to→path/newPath,
 *   session bootstrap for browser tools, …)
 * - honest failures: unsupported args (cwd, pattern, fullPage, selector),
 *   invalid branch names, missing url, registry refusals — all surface as
 *   {success:false} with NO fake success, and the underlying tool is not
 *   called when the adapter rejects up front
 * - deliberately omitted actions (terminal.cancel, terminal.read,
 *   browser.search, git.push, git.createPR) are NOT registered
 * - zod argsSchemas reject bad inputs
 * - setDelegateToolId mirroring is recorded for every delegating action
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/* ── Tool registry: mocked at the execute boundary ─────────────────── */
type ExecuteResult = { ok: true; result: unknown } | { ok: false; error: string };

const mocks = vi.hoisted(() => ({
  calls: [] as Array<{ toolId: string; inputs: Record<string, unknown> }>,
  handlers: new Map<string, ExecuteResult | ((inputs: Record<string, unknown>) => ExecuteResult)>(),
  execute: vi.fn(),
}));

vi.mock("@/lib/litt-intelligence/tool-registry", () => ({
  toolRegistry: {
    execute: mocks.execute,
    register: vi.fn(),
    get: vi.fn(() => undefined),
  },
}));

/* ── Real station modules (register on import) ─────────────────────── */
import "../code";
import "../files";
import "../git";
import "../deploy";
import "../checks";
import "../terminal";
import "../browser";
import "../preview";

import { getStationAction } from "../../registry";
import { getDelegateToolId } from "../../advertise";
import type { StationExecutionContext, StationResult } from "../../types";

const DEFAULT_RESULTS: Record<string, ExecuteResult> = {
  "browser.start_session": {
    ok: true,
    result: { ok: true, session: { id: "sess_1" }, reused: false },
  },
  "preview.start": {
    ok: true,
    result: { workspaceId: "ws_1", status: "ready", port: 3100, framework: "nextjs" },
  },
  "preview.stop": {
    ok: true,
    result: { success: true, workspaceId: "ws_1", status: "stopped" },
  },
  "browser.snapshot": {
    ok: true,
    result: {
      success: true,
      data: {
        url: "http://localhost:3100/",
        textContent: "Hello world",
        accessibility: { role: "RootWebArea", name: "" },
      },
    },
  },
  "browser.screenshot": {
    ok: true,
    result: {
      success: true,
      data: { screenshot: "data:image/png;base64,AAA" },
      screenshotUrl: "data:image/png;base64,AAA",
    },
  },
};

mocks.execute.mockImplementation(
  async (id: string, inputs: Record<string, unknown>): Promise<ExecuteResult> => {
    mocks.calls.push({ toolId: id, inputs });
    const handler = mocks.handlers.get(id) ?? DEFAULT_RESULTS[id];
    if (typeof handler === "function") return handler(inputs);
    return handler ?? { ok: true, result: { success: true } };
  },
);

function makeCtx(overrides: Partial<StationExecutionContext> = {}): StationExecutionContext {
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
    transport: {},
    actionContext: { userId: "user_1", projectId: "proj_1", actionRunId: "run_1" },
    ...overrides,
  };
}

function action(id: string) {
  const a = getStationAction(id);
  if (!a) throw new Error(`station action ${id} not registered`);
  return a;
}

async function run(id: string, args: unknown, ctx?: StationExecutionContext): Promise<StationResult> {
  const result = (await action(id).execute(args as never, ctx ?? makeCtx())) as StationResult;
  return result;
}

function callsFor(toolId: string) {
  return mocks.calls.filter((c) => c.toolId === toolId);
}

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.handlers.clear();
  mocks.execute.mockClear();
  // re-arm the default implementation (mockClear keeps implementation, but be explicit)
  mocks.execute.mockImplementation(
    async (id: string, inputs: Record<string, unknown>): Promise<ExecuteResult> => {
      mocks.calls.push({ toolId: id, inputs });
      const handler = mocks.handlers.get(id) ?? DEFAULT_RESULTS[id];
      if (typeof handler === "function") return handler(inputs);
      return handler ?? { ok: true, result: { success: true } };
    },
  );
});

describe("code station", () => {
  it("code.search delegates to search_code with query+glob", async () => {
    const res = await run("code.search", { query: "TODO", glob: "src/**/*.ts" });
    expect(res.success).toBe(true);
    expect(callsFor("search_code")).toHaveLength(1);
    expect(callsFor("search_code")[0].inputs).toMatchObject({ query: "TODO", glob: "src/**/*.ts" });
  });

  it("code.search omits glob when absent (registry rejects explicit undefined)", async () => {
    await run("code.search", { query: "TODO" });
    const inputs = callsFor("search_code")[0].inputs;
    expect(inputs).toMatchObject({ query: "TODO" });
    expect("glob" in inputs).toBe(false);
  });

  it("code.readFile delegates to files.read with ctx projectId", async () => {
    await run("code.readFile", { path: "src/index.ts" });
    expect(callsFor("files.read")[0].inputs).toMatchObject({
      projectId: "proj_1",
      path: "src/index.ts",
    });
  });

  it("code.readFile fails honestly without a projectId and does not call the tool", async () => {
    const res = await run("code.readFile", { path: "src/index.ts" }, makeCtx({ projectId: null }));
    expect(res.success).toBe(false);
    expect(callsFor("files.read")).toHaveLength(0);
  });

  it("code.writeFile delegates to files.write", async () => {
    await run("code.writeFile", { path: "src/a.ts", content: "export {};" });
    expect(callsFor("files.write")[0].inputs).toMatchObject({
      projectId: "proj_1",
      path: "src/a.ts",
      content: "export {};",
    });
  });

  it("code.refactor delegates to apply_patch with the patch shape", async () => {
    const patches = [{ search: "const x = 1;", replace: "const x = 2;" }];
    await run("code.refactor", { path: "src/a.ts", patches });
    expect(callsFor("apply_patch")[0].inputs).toMatchObject({ path: "src/a.ts", patches });
  });
});

describe("files station", () => {
  it("files.create type=file delegates to files.write with empty content", async () => {
    await run("files.create", { path: "notes.txt", type: "file" });
    expect(callsFor("files.write")[0].inputs).toMatchObject({
      projectId: "proj_1",
      path: "notes.txt",
      content: "",
    });
    expect(callsFor("files.mkdir")).toHaveLength(0);
  });

  it("files.create type=dir delegates to files.mkdir (no terminal fallback needed)", async () => {
    await run("files.create", { path: "assets/img", type: "dir" });
    expect(callsFor("files.mkdir")[0].inputs).toMatchObject({ path: "assets/img" });
    expect(callsFor("files.write")).toHaveLength(0);
    expect(callsFor("terminal.execute")).toHaveLength(0);
  });

  it("files.move maps from/to → path/newPath on files.rename", async () => {
    await run("files.move", { from: "a.txt", to: "b.txt" });
    expect(callsFor("files.rename")[0].inputs).toMatchObject({ path: "a.txt", newPath: "b.txt" });
  });

  it("files.delete delegates to files.delete and is approval-gated", async () => {
    await run("files.delete", { path: "old.txt" });
    expect(callsFor("files.delete")[0].inputs).toMatchObject({ path: "old.txt" });
    expect(action("files.delete").requiresApproval).toBe(true);
  });

  it("files.read delegates to files.read", async () => {
    await run("files.read", { path: "README.md" });
    expect(callsFor("files.read")[0].inputs).toMatchObject({ projectId: "proj_1", path: "README.md" });
  });
});

describe("git station", () => {
  it("git.status delegates with ctx projectId", async () => {
    await run("git.status", {});
    expect(callsFor("git.status")[0].inputs).toMatchObject({ projectId: "proj_1" });
  });

  it("git.diff without path sends no path key", async () => {
    await run("git.diff", {});
    const inputs = callsFor("git.diff")[0].inputs;
    expect("path" in inputs).toBe(false);
  });

  it("git.diff with path forwards it", async () => {
    await run("git.diff", { path: "src/a.ts" });
    expect(callsFor("git.diff")[0].inputs).toMatchObject({ path: "src/a.ts" });
  });

  it("git.branch validates the name then delegates terminal.execute", async () => {
    await run("git.branch", { name: "feat/station-bridge" });
    expect(callsFor("terminal.execute")[0].inputs).toMatchObject({
      command: "git checkout -b feat/station-bridge",
      projectId: "proj_1",
    });
  });

  it.each(["evil; rm -rf /", "has space", "a|b", "$(whoami)", "a..b", "-x"])(
    "git.branch rejects unsafe name %p without calling the tool",
    async (name) => {
      const res = await run("git.branch", { name });
      expect(res.success).toBe(false);
      expect((res as { errorCode?: string }).errorCode).toBe("invalid_args");
      expect(callsFor("terminal.execute")).toHaveLength(0);
    },
  );

  it("git.commit delegates to git.commit", async () => {
    await run("git.commit", { message: "feat: bridge" });
    expect(callsFor("git.commit")[0].inputs).toMatchObject({ message: "feat: bridge" });
  });
});

describe("deploy station", () => {
  it("deploy.preview delegates to project.deploy (not the LiTT-app deploy.execute)", async () => {
    const res = await run("deploy.preview", {});
    expect(res.success).toBe(true);
    expect(callsFor("project.deploy")).toHaveLength(1);
    expect(callsFor("project.deploy")[0].inputs).toEqual({});
    expect(callsFor("deploy.execute")).toHaveLength(0);
    expect(action("deploy.preview").requiresApproval).toBe(true);
  });

  it("deploy.production delegates to project.deploy and is approval-gated", async () => {
    await run("deploy.production", {});
    expect(callsFor("project.deploy")).toHaveLength(1);
    expect(action("deploy.production").requiresApproval).toBe(true);
  });

  it("deploy.status delegates to deploy.verify with the url", async () => {
    await run("deploy.status", { url: "https://example.com" });
    expect(callsFor("deploy.verify")[0].inputs).toMatchObject({ url: "https://example.com" });
  });

  it("deploy.status without url fails honestly and does not call the tool", async () => {
    const res = await run("deploy.status", {});
    expect(res.success).toBe(false);
    expect((res as { errorCode?: string }).errorCode).toBe("invalid_args");
    expect(callsFor("deploy.verify")).toHaveLength(0);
  });
});

describe("checks station", () => {
  it.each([
    ["checks.typecheck", "typecheck.run"],
    ["checks.lint", "lint.run"],
    ["checks.test", "test.run"],
    ["checks.build", "build.run"],
  ])("%s delegates to %s with no inputs", async (stationId, toolId) => {
    const res = await run(stationId, stationId === "checks.test" ? {} : {});
    expect(res.success).toBe(true);
    expect(callsFor(toolId)).toHaveLength(1);
    expect(callsFor(toolId)[0].inputs).toEqual({});
    expect(action(stationId).mutating).toBe(false);
  });

  it("checks.test with a pattern fails honestly (backend has no pattern support)", async () => {
    const res = await run("checks.test", { pattern: "foo.test.ts" });
    expect(res.success).toBe(false);
    expect((res as { errorCode?: string }).errorCode).toBe("invalid_args");
    expect(callsFor("test.run")).toHaveLength(0);
  });
});

describe("terminal station", () => {
  it("terminal.execute delegates with command+projectId", async () => {
    await run("terminal.execute", { command: "ls -la" });
    expect(callsFor("terminal.execute")[0].inputs).toMatchObject({
      command: "ls -la",
      projectId: "proj_1",
    });
    expect(action("terminal.execute").mutating).toBe(true);
  });

  it("terminal.execute with cwd fails honestly (backend runs in the workspace root)", async () => {
    const res = await run("terminal.execute", { command: "ls", cwd: "/tmp" });
    expect(res.success).toBe(false);
    expect((res as { errorCode?: string }).errorCode).toBe("invalid_args");
    expect(callsFor("terminal.execute")).toHaveLength(0);
  });

  it("registry refusals surface honestly (no fake success)", async () => {
    mocks.handlers.set("terminal.execute", {
      ok: false,
      error: 'Tool "terminal.execute" is disabled',
    });
    const res = await run("terminal.execute", { command: "ls" });
    expect(res.success).toBe(false);
    expect((res as { error?: string }).error).toContain("disabled");
  });
});

describe("browser station", () => {
  it("browser.navigate starts a session then navigates", async () => {
    const res = await run("browser.navigate", { url: "https://example.com" });
    expect(res.success).toBe(true);
    expect(callsFor("browser.start_session")).toHaveLength(1);
    expect(callsFor("browser.start_session")[0].inputs).toMatchObject({
      userId: "user_1",
      conversationId: "conv_1",
    });
    const nav = callsFor("browser.navigate");
    expect(nav).toHaveLength(1);
    expect(nav[0].inputs).toMatchObject({
      sessionId: "sess_1",
      userId: "user_1",
      url: "https://example.com",
    });
  });

  it("browser.type maps text → value (the backend requires value)", async () => {
    await run("browser.type", { selector: "#q", text: "hello" });
    expect(callsFor("browser.type")[0].inputs).toMatchObject({
      sessionId: "sess_1",
      userId: "user_1",
      selector: "#q",
      value: "hello",
    });
    expect("text" in callsFor("browser.type")[0].inputs).toBe(false);
  });

  it("browser.click forwards the selector", async () => {
    await run("browser.click", { selector: "#btn" });
    expect(callsFor("browser.click")[0].inputs).toMatchObject({
      sessionId: "sess_1",
      selector: "#btn",
    });
  });

  it("browser.scroll forwards direction and amount", async () => {
    await run("browser.scroll", { direction: "down", amount: 400 });
    expect(callsFor("browser.scroll")[0].inputs).toMatchObject({
      direction: "down",
      amount: 400,
    });
  });

  it("browser.screenshot returns the captured image, never a claim", async () => {
    const res = await run("browser.screenshot", {});
    expect(res.success).toBe(true);
    expect((res as { screenshot?: string }).screenshot).toBe("data:image/png;base64,AAA");
  });

  it("browser.screenshot with fullPage:true fails honestly", async () => {
    const res = await run("browser.screenshot", { fullPage: true });
    expect(res.success).toBe(false);
    expect((res as { errorCode?: string }).errorCode).toBe("invalid_args");
    expect(callsFor("browser.screenshot")).toHaveLength(0);
  });

  it("browser.readDom returns the snapshot textContent", async () => {
    const res = await run("browser.readDom", {});
    expect(res.success).toBe(true);
    expect(callsFor("browser.snapshot")).toHaveLength(1);
    expect((res as { textContent?: string }).textContent).toBe("Hello world");
  });

  it("browser.readDom with a selector fails honestly (no selector scope in snapshot)", async () => {
    const res = await run("browser.readDom", { selector: "#main" });
    expect(res.success).toBe(false);
    expect(callsFor("browser.snapshot")).toHaveLength(0);
  });

  it("browser.readAccessibility returns the a11y tree portion", async () => {
    const res = await run("browser.readAccessibility", {});
    expect(res.success).toBe(true);
    expect((res as { accessibility?: unknown }).accessibility).toEqual({
      role: "RootWebArea",
      name: "",
    });
  });

  it("browser.goBack delegates to browser.back", async () => {
    await run("browser.goBack", {});
    expect(callsFor("browser.back")[0].inputs).toMatchObject({ sessionId: "sess_1" });
  });

  it("a failed session start propagates and the tool is never called", async () => {
    mocks.handlers.set("browser.start_session", { ok: false, error: "beta_only" });
    const res = await run("browser.navigate", { url: "https://example.com" });
    expect(res.success).toBe(false);
    expect(callsFor("browser.navigate")).toHaveLength(0);
  });
});

describe("preview station", () => {
  it("preview.launch delegates preview.start and adds the real preview URL", async () => {
    const res = await run("preview.launch", {});
    expect(res.success).toBe(true);
    expect(callsFor("preview.start")).toHaveLength(1);
    expect((res as { previewUrl?: string }).previewUrl).toBe("http://localhost:4001/preview/ws_1");
    expect((res as { status?: string }).status).toBe("ready");
  });

  it("preview.reload is stop-then-start; success follows the start", async () => {
    const res = await run("preview.reload", {});
    expect(res.success).toBe(true);
    const order = mocks.calls.map((c) => c.toolId);
    expect(order.indexOf("preview.stop")).toBeLessThan(order.indexOf("preview.start"));
    expect((res as { reloaded?: boolean }).reloaded).toBe(true);
    expect((res as { stopOk?: boolean }).stopOk).toBe(true);
  });

  it("preview.reload reports a failed start honestly", async () => {
    mocks.handlers.set("preview.start", { ok: false, error: "no workspace" });
    const res = await run("preview.reload", {});
    expect(res.success).toBe(false);
  });

  it("preview.inspect navigates the browser to the preview URL and returns its text", async () => {
    const res = await run("preview.inspect", {});
    expect(res.success).toBe(true);
    expect((res as { url?: string }).url).toBe("http://localhost:4001/preview/ws_1");
    expect((res as { textContent?: string }).textContent).toBe("Hello world");
    const nav = callsFor("browser.navigate");
    expect(nav).toHaveLength(1);
    expect(nav[0].inputs).toMatchObject({
      sessionId: "sess_1",
      url: "http://localhost:4001/preview/ws_1",
    });
    expect(callsFor("browser.snapshot")).toHaveLength(1);
  });

  it("preview.inspect with a selector fails honestly", async () => {
    const res = await run("preview.inspect", { selector: "#app" });
    expect(res.success).toBe(false);
    expect(callsFor("browser.snapshot")).toHaveLength(0);
  });

  it("preview.screenshot returns url + the real captured image", async () => {
    const res = await run("preview.screenshot", {});
    expect(res.success).toBe(true);
    expect((res as { url?: string }).url).toBe("http://localhost:4001/preview/ws_1");
    expect((res as { screenshot?: string }).screenshot).toBe("data:image/png;base64,AAA");
  });

  it("preview.screenshot with fullPage:true fails honestly", async () => {
    const res = await run("preview.screenshot", { fullPage: true });
    expect(res.success).toBe(false);
    expect(callsFor("browser.screenshot")).toHaveLength(0);
  });

  it("a failed preview.start aborts the inspect chain before any browser call", async () => {
    mocks.handlers.set("preview.start", { ok: false, error: "workspace unreachable" });
    const res = await run("preview.inspect", {});
    expect(res.success).toBe(false);
    expect(callsFor("browser.start_session")).toHaveLength(0);
  });
});

describe("deliberately omitted actions are not registered", () => {
  it.each([
    "terminal.cancel",
    "terminal.read",
    "browser.search",
    "git.push",
    "git.createPR",
  ])("%s is not in the registry", (id) => {
    expect(getStationAction(id)).toBeUndefined();
  });
});

describe("delegate tool-id mirroring (approval policy)", () => {
  it.each([
    ["code.search", "search_code"],
    ["code.readFile", "files.read"],
    ["code.writeFile", "files.write"],
    ["code.refactor", "apply_patch"],
    ["files.create", "files.write"],
    ["files.move", "files.rename"],
    ["files.delete", "files.delete"],
    ["files.read", "files.read"],
    ["git.status", "git.status"],
    ["git.diff", "git.diff"],
    ["git.branch", "terminal.execute"],
    ["git.commit", "git.commit"],
    ["deploy.preview", "project.deploy"],
    ["deploy.production", "project.deploy"],
    ["deploy.status", "deploy.verify"],
    ["checks.typecheck", "typecheck.run"],
    ["checks.lint", "lint.run"],
    ["checks.test", "test.run"],
    ["checks.build", "build.run"],
    ["terminal.execute", "terminal.execute"],
    ["browser.navigate", "browser.navigate"],
    ["browser.click", "browser.click"],
    ["browser.type", "browser.type"],
    ["browser.scroll", "browser.scroll"],
    ["browser.screenshot", "browser.screenshot"],
    ["browser.readDom", "browser.snapshot"],
    ["browser.readAccessibility", "browser.snapshot"],
    ["browser.goBack", "browser.back"],
    ["preview.launch", "preview.start"],
    ["preview.reload", "preview.start"],
    ["preview.inspect", "browser.snapshot"],
    ["preview.screenshot", "browser.screenshot"],
  ])("%s mirrors %s", (stationId, toolId) => {
    expect(getDelegateToolId(stationId)).toBe(toolId);
  });
});

describe("args validation (zod)", () => {
  it("files.delete rejects a missing path", () => {
    expect(action("files.delete").argsSchema.safeParse({}).success).toBe(false);
    expect(action("files.delete").argsSchema.safeParse({ path: "a.txt" }).success).toBe(true);
  });

  it("code.search rejects an empty query", () => {
    expect(action("code.search").argsSchema.safeParse({ query: "" }).success).toBe(false);
  });

  it("browser.navigate rejects a non-URL", () => {
    expect(action("browser.navigate").argsSchema.safeParse({ url: "not-a-url" }).success).toBe(false);
  });

  it("files.create rejects an unknown type", () => {
    expect(action("files.create").argsSchema.safeParse({ path: "x", type: "symlink" }).success).toBe(false);
  });

  it("deploy.status rejects a non-URL url", () => {
    expect(action("deploy.status").argsSchema.safeParse({ url: "not-a-url" }).success).toBe(false);
    expect(action("deploy.status").argsSchema.safeParse({}).success).toBe(true);
  });

  it("browser.scroll rejects an unknown direction", () => {
    expect(
      action("browser.scroll").argsSchema.safeParse({ direction: "diagonal" }).success,
    ).toBe(false);
  });
});
