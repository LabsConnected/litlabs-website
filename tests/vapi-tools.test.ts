// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import {
  isSafeWorkspacePath,
  isSafeToolName,
  parseVapiPayload,
  argsOf,
  serializeToolResult,
  authorizeVapiRequest,
  authDiagnostic,
  ownerClerkId,
  packageManagerCommand,
  CHECK_IDS,
  TOOL_NAMES,
  ok,
  fail,
} from "@/lib/vapi-tools";

// ─── Path safety ────────────────────────────────────────────────

describe("isSafeWorkspacePath", () => {
  it("allows normal relative paths", () => {
    expect(isSafeWorkspacePath("src/app/page.tsx")).toBe(true);
    expect(isSafeWorkspacePath("README.md")).toBe(true);
    expect(isSafeWorkspacePath("src/components/Button.tsx")).toBe(true);
  });

  it("rejects empty and dot", () => {
    expect(isSafeWorkspacePath("")).toBe(false);
    expect(isSafeWorkspacePath(".")).toBe(false);
  });

  it("rejects absolute paths", () => {
    expect(isSafeWorkspacePath("/etc/passwd")).toBe(false);
    expect(isSafeWorkspacePath("/root/.ssh/id_rsa")).toBe(false);
  });

  it("rejects path traversal", () => {
    expect(isSafeWorkspacePath("../secret")).toBe(false);
    expect(isSafeWorkspacePath("src/../../etc/passwd")).toBe(false);
    expect(isSafeWorkspacePath("foo/../bar/../../baz")).toBe(false);
  });

  it("rejects null bytes", () => {
    expect(isSafeWorkspacePath("src\u0000/../../etc/passwd")).toBe(false);
  });

  it("rejects .env files", () => {
    expect(isSafeWorkspacePath(".env")).toBe(false);
    expect(isSafeWorkspacePath(".env.local")).toBe(false);
    expect(isSafeWorkspacePath(".env.production")).toBe(false);
    expect(isSafeWorkspacePath("config/.env")).toBe(false);
  });

  it("rejects node_modules", () => {
    expect(isSafeWorkspacePath("node_modules/react/index.js")).toBe(false);
    expect(isSafeWorkspacePath("src/node_modules/foo")).toBe(false);
  });

  it("rejects .git internals", () => {
    expect(isSafeWorkspacePath(".git/config")).toBe(false);
    expect(isSafeWorkspacePath(".git/HEAD")).toBe(false);
    expect(isSafeWorkspacePath("submodule/.git/objects/abc")).toBe(false);
  });

  it("rejects credentials and SSH keys", () => {
    expect(isSafeWorkspacePath(".ssh/id_rsa")).toBe(false);
    expect(isSafeWorkspacePath("id_rsa")).toBe(false);
    expect(isSafeWorkspacePath(".aws/credentials")).toBe(false);
    expect(isSafeWorkspacePath("credentials.json")).toBe(false);
    expect(isSafeWorkspacePath("secrets.yaml")).toBe(false);
    expect(isSafeWorkspacePath("config/secrets.json")).toBe(false);
    expect(isSafeWorkspacePath(".npmrc")).toBe(false);
    expect(isSafeWorkspacePath(".htpasswd")).toBe(false);
  });

  it("normalizes backslashes", () => {
    expect(isSafeWorkspacePath("src\\..\\..\\etc")).toBe(false);
    expect(isSafeWorkspacePath("src\\app\\page.tsx")).toBe(true);
  });
});

// ─── Tool allowlisting ──────────────────────────────────────────

describe("isSafeToolName", () => {
  it("accepts all allowlisted tools", () => {
    for (const name of TOOL_NAMES) {
      expect(isSafeToolName(name)).toBe(true);
    }
  });

  it("includes the new git, search, memory, approval, and browser test tools", () => {
    const expected = [
      "git_status",
      "create_branch",
      "commit_changes",
      "push_branch",
      "create_pull_request",
      "search_code",
      "remember_project_context",
      "request_approval",
      "browser_test",
    ];
    for (const name of expected) {
      expect(TOOL_NAMES).toContain(name);
      expect(isSafeToolName(name)).toBe(true);
    }
  });

  it("rejects unknown tools", () => {
    expect(isSafeToolName("deploy")).toBe(false);
    expect(isSafeToolName("")).toBe(false);
    expect(isSafeToolName("exec")).toBe(false);
    expect(isSafeToolName("rm_rf")).toBe(false);
    expect(isSafeToolName("shell_injection")).toBe(false);
  });
});

// ─── Payload parsing ────────────────────────────────────────────

describe("parseVapiPayload", () => {
  it("parses a valid Vapi tool-calls payload", () => {
    const body = {
      message: {
        type: "tool-calls",
        toolCallList: [
          {
            id: "call_1",
            name: "read_file",
            arguments: { project_id: "proj_123", path: "src/app/page.tsx" },
          },
        ],
      },
    };
    const calls = parseVapiPayload(body);
    expect(calls).toHaveLength(1);
    expect(calls![0].id).toBe("call_1");
    expect(calls![0].name).toBe("read_file");
    expect(calls![0].arguments).toEqual({ project_id: "proj_123", path: "src/app/page.tsx" });
  });

  it("accepts parameters as an alternative to arguments", () => {
    const body = {
      message: {
        toolCallList: [
          { id: "call_2", name: "get_active_project", parameters: {} },
        ],
      },
    };
    const calls = parseVapiPayload(body);
    expect(calls).toHaveLength(1);
    expect(argsOf(calls![0])).toEqual({});
  });

  it("returns null for missing message", () => {
    expect(parseVapiPayload({})).toBeNull();
    expect(parseVapiPayload(null)).toBeNull();
    expect(parseVapiPayload("string")).toBeNull();
  });

  it("returns null for missing toolCallList", () => {
    expect(parseVapiPayload({ message: { type: "tool-calls" } })).toBeNull();
    expect(parseVapiPayload({ message: {} })).toBeNull();
  });

  it("returns null for empty toolCallList", () => {
    expect(parseVapiPayload({ message: { toolCallList: [] } })).toBeNull();
  });

  it("skips entries missing id or name", () => {
    const body = {
      message: {
        toolCallList: [
          { id: "call_1", name: "read_file", arguments: {} },
          { id: "call_2" }, // missing name
          { name: "read_file" }, // missing id
          { id: "call_3", name: "edit_file", arguments: {} },
        ],
      },
    };
    const calls = parseVapiPayload(body);
    expect(calls).toHaveLength(2);
    expect(calls![0].id).toBe("call_1");
    expect(calls![1].id).toBe("call_3");
  });
});

// ─── Result serialization ───────────────────────────────────────

describe("serializeToolResult", () => {
  it("produces a single-line JSON string", () => {
    const result = ok("proj_123", "Success", { count: 5 });
    const serialized = serializeToolResult(result);
    expect(typeof serialized).toBe("string");
    expect(serialized).not.toContain("\n");
    const parsed = JSON.parse(serialized);
    expect(parsed.success).toBe(true);
    expect(parsed.projectId).toBe("proj_123");
    expect(parsed.data.count).toBe(5);
  });

  it("serializes failure results", () => {
    const result = fail("Something went wrong");
    const serialized = serializeToolResult(result);
    expect(typeof serialized).toBe("string");
    expect(serialized).not.toContain("\n");
    const parsed = JSON.parse(serialized);
    expect(parsed.success).toBe(false);
    expect(parsed.message).toBe("Something went wrong");
  });
});

// ─── Auth ───────────────────────────────────────────────────────

describe("authorizeVapiRequest", () => {
  const TOKEN = "test-token-0123456789-abcdef";

  beforeEach(() => {
    process.env.LITTLABS_VAPI_TOOL_TOKEN = TOKEN;
  });

  afterEach(() => {
    delete process.env.LITTLABS_VAPI_TOOL_TOKEN;
  });

  it("accepts a valid Bearer token", () => {
    expect(authorizeVapiRequest(`Bearer ${TOKEN}`)).toBe(true);
  });

  it("rejects a wrong token", () => {
    expect(authorizeVapiRequest("Bearer wrong-token-value-here")).toBe(false);
  });

  it("rejects missing Authorization header", () => {
    expect(authorizeVapiRequest("")).toBe(false);
    expect(authorizeVapiRequest(null as unknown as string)).toBe(false);
  });

  it("rejects non-Bearer schemes", () => {
    expect(authorizeVapiRequest(`Basic ${TOKEN}`)).toBe(false);
  });

  it("rejects when token env var is not set", () => {
    delete process.env.LITTLABS_VAPI_TOOL_TOKEN;
    expect(authorizeVapiRequest(`Bearer ${TOKEN}`)).toBe(false);
  });

  it("rejects when token is too short", () => {
    process.env.LITTLABS_VAPI_TOOL_TOKEN = "short";
    expect(authorizeVapiRequest("Bearer short")).toBe(false);
  });

  it("accepts a raw token without Bearer prefix", () => {
    expect(authorizeVapiRequest(TOKEN)).toBe(true);
  });

  it("rejects a wrong raw token without Bearer prefix", () => {
    expect(authorizeVapiRequest("wrong-token-value-here")).toBe(false);
  });
});

describe("authDiagnostic", () => {
  const TOKEN = "test-token-0123456789-abcdef";

  beforeEach(() => {
    process.env.LITTLABS_VAPI_TOOL_TOKEN = TOKEN;
  });

  afterEach(() => {
    delete process.env.LITTLABS_VAPI_TOOL_TOKEN;
  });

  it("reports correct diagnostics for a valid Bearer token", () => {
    const diag = authDiagnostic(`Bearer ${TOKEN}`);
    expect(diag.authHeaderPresent).toBe(true);
    expect(diag.bearerPrefixPresent).toBe(true);
    expect(diag.credentialMatched).toBe(true);
    expect(diag.expectedTokenConfigured).toBe(true);
  });

  it("reports correct diagnostics for a valid raw token", () => {
    const diag = authDiagnostic(TOKEN);
    expect(diag.authHeaderPresent).toBe(true);
    expect(diag.bearerPrefixPresent).toBe(false);
    expect(diag.credentialMatched).toBe(true);
    expect(diag.expectedTokenConfigured).toBe(true);
  });

  it("reports correct diagnostics for a wrong token", () => {
    const diag = authDiagnostic("Bearer wrong-token-value-here");
    expect(diag.authHeaderPresent).toBe(true);
    expect(diag.bearerPrefixPresent).toBe(true);
    expect(diag.credentialMatched).toBe(false);
    expect(diag.expectedTokenConfigured).toBe(true);
  });

  it("reports correct diagnostics for missing header", () => {
    const diag = authDiagnostic("");
    expect(diag.authHeaderPresent).toBe(false);
    expect(diag.bearerPrefixPresent).toBe(false);
    expect(diag.credentialMatched).toBe(false);
    expect(diag.expectedTokenConfigured).toBe(true);
  });

  it("reports expectedTokenConfigured=false when env var is unset", () => {
    delete process.env.LITTLABS_VAPI_TOOL_TOKEN;
    const diag = authDiagnostic(`Bearer ${TOKEN}`);
    expect(diag.expectedTokenConfigured).toBe(false);
    expect(diag.credentialMatched).toBe(false);
  });
});

describe("ownerClerkId", () => {
  afterEach(() => {
    delete process.env.LITTLABS_VAPI_OWNER_CLERK_ID;
  });

  it("returns the configured owner ID", () => {
    process.env.LITTLABS_VAPI_OWNER_CLERK_ID = "user_abc123";
    expect(ownerClerkId()).toBe("user_abc123");
  });

  it("returns null when not configured", () => {
    delete process.env.LITTLABS_VAPI_OWNER_CLERK_ID;
    expect(ownerClerkId()).toBeNull();
  });

  it("returns null for empty string", () => {
    process.env.LITTLABS_VAPI_OWNER_CLERK_ID = "";
    expect(ownerClerkId()).toBeNull();
  });
});

// ─── Check command builder ──────────────────────────────────────

describe("packageManagerCommand", () => {
  it("builds typecheck command for pnpm", () => {
    expect(packageManagerCommand("pnpm", "typecheck")).toBe("pnpm exec tsc --noEmit");
  });

  it("builds typecheck command for npm", () => {
    expect(packageManagerCommand("npm", "typecheck")).toBe("npm exec tsc --noEmit");
  });

  it("builds lint command", () => {
    expect(packageManagerCommand("pnpm", "lint")).toBe("pnpm run lint");
  });

  it("builds test command", () => {
    expect(packageManagerCommand("pnpm", "test")).toBe("pnpm test -- --run");
  });

  it("builds build command", () => {
    expect(packageManagerCommand("npm", "build")).toBe("npm run build");
  });

  it("returns null for unsupported package manager", () => {
    expect(packageManagerCommand("bun", "lint")).toBeNull();
    expect(packageManagerCommand(null, "lint")).toBeNull();
  });
});

describe("CHECK_IDS", () => {
  it("contains only typecheck, lint, test, build", () => {
    expect([...CHECK_IDS]).toEqual(["typecheck", "lint", "test", "build"]);
  });

  it("does not include security, accessibility, or performance", () => {
    expect(CHECK_IDS).not.toContain("security");
    expect(CHECK_IDS).not.toContain("accessibility");
    expect(CHECK_IDS).not.toContain("performance");
  });
});

// ─── Route handler integration tests ────────────────────────────
//
// These test the full POST handler with mocked external dependencies.

describe("POST /api/vapi/tools — route handler", () => {
  const TOKEN = "route-test-token-0123456789";
  const OWNER_ID = "user_owner123";
  const PROJECT_ID = "proj_abc";

  // We mock the server-side dependencies so the route can run in vitest
  // without Supabase or the terminal server.
  vi.mock("@/lib/supabase", () => ({
    supabaseAdmin: {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() => ({ data: null })),
            single: vi.fn(() => ({ data: null })),
          })),
        })),
        insert: vi.fn(() => ({ data: null })),
        upsert: vi.fn(() => ({ data: null })),
      })),
    },
    getSupabaseAdmin: vi.fn(() => null),
  }));

  vi.mock("@/lib/projects/project-repository", () => ({
    getProject: vi.fn(),
    verifyProjectWorkspace: vi.fn(),
    updateProjectRuntime: vi.fn(),
  }));

  vi.mock("@/lib/projects/resolve-current-project", () => ({
    resolveCurrentProject: vi.fn(),
  }));

  vi.mock("@/lib/terminal-auth", () => ({
    createTerminalToken: vi.fn(() => ({ token: "test-token", expiresAt: 0 })),
  }));

  vi.mock("@/lib/file-audit", () => ({
    logFileOperation: vi.fn(() => Promise.resolve()),
  }));

  vi.mock("@/lib/deployments", () => ({
    getDeployments: vi.fn(),
  }));

  // Mock the heavy transitive dependencies of @/lib/project-tools/registry
  // that are NOT otherwise mocked. Without these mocks, importing the route
  // handler pulls in the full dependency graph (Playwright/browser executor,
  // GitHub Octokit, memory service, etc.) which can exceed the 10s hookTimeout
  // under full-suite cold load. The registry's tool execution logic is not
  // under test here — the route handler's orchestration (auth, payload
  // parsing, response formatting) is.
  vi.mock("@/lib/github-pat", () => ({
    getUserGitHubOctokit: vi.fn(),
  }));

  vi.mock("@/lib/studio/memory-service", () => ({
    persistMemory: vi.fn(),
    recallMemories: vi.fn(() => Promise.resolve([])),
    formatMemoryContext: vi.fn(() => ""),
  }));

  vi.mock("@/lib/browser-jobs", () => ({
    createJob: vi.fn(),
    getJob: vi.fn(),
    listJobs: vi.fn(),
    updateJob: vi.fn(),
    deleteJob: vi.fn(),
  }));

  vi.mock("@/lib/browser-job-executor", () => ({
    executeBrowserJob: vi.fn(),
  }));

  vi.mock("@/lib/rate-limiter", () => ({
    rateLimit: vi.fn(() => Promise.resolve({ success: true, remaining: 59, resetTime: 60 })),
  }));

  let POST: typeof import("@/app/api/vapi/tools/route").POST;
  let getProject: typeof import("@/lib/projects/project-repository").getProject;
  let verifyProjectWorkspace: typeof import("@/lib/projects/project-repository").verifyProjectWorkspace;
  let resolveCurrentProject: typeof import("@/lib/projects/resolve-current-project").resolveCurrentProject;
  let getDeployments: typeof import("@/lib/deployments").getDeployments;

  beforeAll(async () => {
    const route = await import("@/app/api/vapi/tools/route");
    POST = route.POST;
    const projectRepo = await import("@/lib/projects/project-repository");
    getProject = projectRepo.getProject;
    verifyProjectWorkspace = projectRepo.verifyProjectWorkspace;
    const resolveProj = await import("@/lib/projects/resolve-current-project");
    resolveCurrentProject = resolveProj.resolveCurrentProject;
    const deps = await import("@/lib/deployments");
    getDeployments = deps.getDeployments;
  });

  function makeRequest(body: unknown, headers: Record<string, string> = {}): import("next/server").NextRequest {
    return new NextRequest("https://litlabs.net/api/vapi/tools", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
        ...headers,
      },
      body: JSON.stringify(body),
    });
  }

  function makeVapiPayload(calls: Array<{ id: string; name: string; arguments?: Record<string, unknown> }>): unknown {
    return { message: { type: "tool-calls", toolCallList: calls } };
  }

  beforeEach(() => {
    process.env.LITTLABS_VAPI_TOOL_TOKEN = TOKEN;
    process.env.LITTLABS_VAPI_OWNER_CLERK_ID = OWNER_ID;
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.LITTLABS_VAPI_TOOL_TOKEN;
    delete process.env.LITTLABS_VAPI_OWNER_CLERK_ID;
  });

  it("rejects unauthorized requests (no token)", async () => {
    const req = makeRequest(makeVapiPayload([{ id: "c1", name: "get_active_project" }]), {
      Authorization: "",
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects unauthorized requests (wrong token)", async () => {
    const req = makeRequest(makeVapiPayload([{ id: "c1", name: "get_active_project" }]), {
      Authorization: "Bearer wrong-token",
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects malformed payloads (not JSON)", async () => {
    const req = new NextRequest("https://litlabs.net/api/vapi/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects malformed payloads (missing toolCallList)", async () => {
    const req = makeRequest({ message: { type: "tool-calls" } });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 503 when owner identity is not configured", async () => {
    delete process.env.LITTLABS_VAPI_OWNER_CLERK_ID;
    const req = makeRequest(makeVapiPayload([{ id: "c1", name: "get_active_project" }]));
    const res = await POST(req);
    expect(res.status).toBe(503);
  });

  it("rejects unknown tools with a 200 results response", async () => {
    const req = makeRequest(makeVapiPayload([{ id: "c1", name: "delete_everything" }]));
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results).toHaveLength(1);
    expect(json.results[0].toolCallId).toBe("c1");
    const result = JSON.parse(json.results[0].result);
    expect(result.success).toBe(false);
    expect(result.message).toContain("Unknown tool");
  });

  it("rejects invalid project ownership (project not found)", async () => {
    vi.mocked(getProject).mockResolvedValue(null);
    const req = makeRequest(makeVapiPayload([
      { id: "c1", name: "read_file", arguments: { project_id: "foreign_proj", path: "src/app.tsx" } },
    ]));
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    const result = JSON.parse(json.results[0].result);
    expect(result.success).toBe(false);
    expect(result.message).toContain("not found or not owned");
  });

  it("rejects path traversal in read_file", async () => {
    vi.mocked(getProject).mockResolvedValue({
      id: PROJECT_ID,
      userId: OWNER_ID,
      workspaceId: "ws_1",
      workspaceStatus: "ready",
      workspaceRoot: "/workspace",
    } as never);
    vi.mocked(verifyProjectWorkspace).mockResolvedValue({
      project: {} as never,
      workspaceId: "ws_1",
      workspaceRoot: "/workspace",
    });
    const req = makeRequest(makeVapiPayload([
      { id: "c1", name: "read_file", arguments: { project_id: PROJECT_ID, path: "../../../etc/passwd" } },
    ]));
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    const result = JSON.parse(json.results[0].result);
    expect(result.success).toBe(false);
    expect(result.message).toContain("Invalid or blocked workspace path");
  });

  it("rejects .env access in read_file", async () => {
    vi.mocked(getProject).mockResolvedValue({
      id: PROJECT_ID,
      userId: OWNER_ID,
      workspaceId: "ws_1",
      workspaceStatus: "ready",
      workspaceRoot: "/workspace",
    } as never);
    vi.mocked(verifyProjectWorkspace).mockResolvedValue({
      project: {} as never,
      workspaceId: "ws_1",
      workspaceRoot: "/workspace",
    });
    const req = makeRequest(makeVapiPayload([
      { id: "c1", name: "read_file", arguments: { project_id: PROJECT_ID, path: ".env" } },
    ]));
    const res = await POST(req);
    const json = await res.json();
    const result = JSON.parse(json.results[0].result);
    expect(result.success).toBe(false);
    expect(result.message).toContain("Invalid or blocked workspace path");
  });

  it("handles successful get_active_project execution", async () => {
    vi.mocked(resolveCurrentProject).mockResolvedValue({
      projectId: PROJECT_ID,
      projectName: "My Project",
      source: "studio_projects",
      sourceType: "blank",
      repositoryFullName: null,
      repositoryOwner: null,
      repositoryName: null,
      defaultBranch: "main",
      activeBranch: "main",
      workspaceStatus: "ready",
    });
    const req = makeRequest(makeVapiPayload([
      { id: "c1", name: "get_active_project" },
    ]));
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results).toHaveLength(1);
    expect(json.results[0].toolCallId).toBe("c1");
    const result = JSON.parse(json.results[0].result);
    expect(result.success).toBe(true);
    expect(result.projectId).toBe(PROJECT_ID);
    expect(result.message).toContain("My Project");
  });

  it("formats the Vapi response correctly (results array with toolCallId + string result)", async () => {
    vi.mocked(resolveCurrentProject).mockResolvedValue(null);
    const req = makeRequest(makeVapiPayload([
      { id: "call_a", name: "get_active_project" },
      { id: "call_b", name: "get_active_project" },
    ]));
    const res = await POST(req);
    const json = await res.json();
    expect(json.results).toHaveLength(2);
    expect(json.results[0].toolCallId).toBe("call_a");
    expect(json.results[1].toolCallId).toBe("call_b");
    // result must be a string (single-line JSON)
    expect(typeof json.results[0].result).toBe("string");
    expect(json.results[0].result).not.toContain("\n");
  });

  it("returns 200 for handled tool failures (not 500)", async () => {
    vi.mocked(getDeployments).mockRejectedValue(new Error("DB down"));
    const req = makeRequest(makeVapiPayload([
      { id: "c1", name: "get_deployment_status", arguments: { project_id: PROJECT_ID } },
    ]));
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    const result = JSON.parse(json.results[0].result);
    expect(result.success).toBe(false);
  });

  it("rejects missing project_id for project-scoped tools", async () => {
    const req = makeRequest(makeVapiPayload([
      { id: "c1", name: "read_file", arguments: { path: "src/app.tsx" } },
    ]));
    const res = await POST(req);
    const json = await res.json();
    const result = JSON.parse(json.results[0].result);
    expect(result.success).toBe(false);
    expect(result.message).toContain("requires a project_id");
  });
});
