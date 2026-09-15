import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Regression coverage for the web→terminal-server command bridge URL.
 *
 * The route must only ever forward commands to an http(s) endpoint. A
 * missing or non-HTTP configuration (e.g. a wss:// websocket URL being
 * reused as a fetch base) must fail loudly with a configuration error
 * rather than attempting a request that can never succeed.
 */

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ userId: "user_test" })),
}));

// Declared inside the factory: vi.mock is hoisted above top-level
// declarations, so referencing one from here fails at runtime.
vi.mock("@/lib/projects/project-repository", () => {
  class ProjectVerificationError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
      this.name = "ProjectVerificationError";
    }
  }
  return { verifyProjectWorkspace: vi.fn(), ProjectVerificationError };
});

import { POST } from "./route";
import {
  verifyProjectWorkspace,
  ProjectVerificationError as FakeProjectVerificationError,
} from "@/lib/projects/project-repository";

const ENV_KEYS = [
  "TERMINAL_SERVER_INTERNAL_URL",
  "TERMINAL_SERVER_URL",
  "NEXT_PUBLIC_TERMINAL_HTTP_URL",
  "NEXT_PUBLIC_TERMINAL_WS_URL",
  "TERMINAL_INTERNAL_SERVICE_KEY",
];

let savedEnv: Record<string, string | undefined>;
let fetchSpy: ReturnType<typeof vi.fn>;

function req(command: string, extra: Record<string, unknown> = {}): NextRequest {
  return new NextRequest("http://localhost/api/studio/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // A projectId is required by the ownership boundary, which runs before
    // URL resolution. These tests target the transport, so they clear that
    // gate with an owned project.
    body: JSON.stringify({ command, projectId: "proj-owned", ...extra }),
  });
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);
  process.env.TERMINAL_INTERNAL_SERVICE_KEY = "k".repeat(40);
  vi.mocked(verifyProjectWorkspace).mockResolvedValue({
    workspaceId: "ws-owned",
    workspaceRoot: "/data/littree-workspaces/user_test/proj",
  } as never);
  delete process.env.TERMINAL_SERVER_INTERNAL_URL;
  delete process.env.TERMINAL_SERVER_URL;
  delete process.env.NEXT_PUBLIC_TERMINAL_HTTP_URL;
  delete process.env.NEXT_PUBLIC_TERMINAL_WS_URL;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/studio/command — terminal URL resolution", () => {
  it("fails loudly instead of fetching when only a wss:// URL is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_TERMINAL_WS_URL = "wss://terminal.litlabs.net";

    const res = await POST(req("status"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/not configured|configuration/i);
    // The wss:// value must never reach server-side fetch.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses TERMINAL_SERVER_INTERNAL_URL when it is a valid http(s) URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.TERMINAL_SERVER_INTERNAL_URL = "http://litlabs-terminal-server.railway.internal:8080/";

    const res = await POST(req("status"));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://litlabs-terminal-server.railway.internal:8080/internal/command",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects a non-http(s) TERMINAL_SERVER_INTERNAL_URL instead of fetching", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.TERMINAL_SERVER_INTERNAL_URL = "wss://terminal.litlabs.net";

    const res = await POST(req("status"));
    expect(res.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails loudly in production when no internal URL is configured at all", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await POST(req("status"));
    expect(res.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends the internal service key to the upstream", async () => {
    process.env.TERMINAL_SERVER_INTERNAL_URL = "https://terminal.litlabs.net";
    await POST(req("status"));
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Internal-Service-Key": "k".repeat(40),
        }),
      }),
    );
  });
});

/**
 * Browser ownership boundary.
 *
 * terminal-server accepts a bare cwd with no workspaceId because the
 * CLI/Termux machine lane needs it — that caller addresses their own device.
 * A browser does not, so Studio isolation is established here and never
 * inherited from that compatibility. The workspaceId is DERIVED from a
 * project the caller owns and is never accepted from the request.
 */
describe("POST /api/studio/command — browser ownership boundary", () => {
  function ownedWorkspace() {
    vi.mocked(verifyProjectWorkspace).mockResolvedValue({
      workspaceId: "ws-alice",
      workspaceRoot: "/data/littree-workspaces/user_test/proj",
    } as never);
  }

  function body(extra: Record<string, unknown>): NextRequest {
    return new NextRequest("http://localhost/api/studio/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "status", ...extra }),
    });
  }

  beforeEach(() => {
    process.env.TERMINAL_SERVER_INTERNAL_URL = "https://terminal.litlabs.net";
  });

  it("allows a command against a project the caller owns", async () => {
    ownedWorkspace();
    const res = await POST(body({ projectId: "proj-alice" }));

    expect(res.status).toBe(200);
    expect(vi.mocked(verifyProjectWorkspace)).toHaveBeenCalledWith("proj-alice", "user_test");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects a command that names no project", async () => {
    const res = await POST(body({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe("project_required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a client-supplied workspaceId outright", async () => {
    ownedWorkspace();
    const res = await POST(body({ projectId: "proj-alice", workspaceId: "ws-bob" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe("workspace_id_not_accepted");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a project owned by another user", async () => {
    vi.mocked(verifyProjectWorkspace).mockRejectedValue(
      new FakeProjectVerificationError("Project not found", "PROJECT_NOT_FOUND"),
    );
    const res = await POST(body({ projectId: "proj-bob" }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Project not found or not accessible.");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an unknown project with the same response as a foreign one", async () => {
    vi.mocked(verifyProjectWorkspace).mockRejectedValue(
      new FakeProjectVerificationError("Project not found", "PROJECT_NOT_FOUND"),
    );
    const res = await POST(body({ projectId: "proj-nope" }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Project not found or not accessible.");
  });

  it("rejects a project whose workspace is not ready", async () => {
    vi.mocked(verifyProjectWorkspace).mockRejectedValue(
      new FakeProjectVerificationError("Workspace not ready", "WORKSPACE_NOT_READY"),
    );
    const res = await POST(body({ projectId: "proj-alice" }));

    expect(res.status).toBe(409);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["/etc"],
    ["/data/littree-workspaces/user_bob/proj"],
    ["../../user_bob/proj"],
    ["src/../../../etc"],
    ["C:\Windows"],
    ["\\server\share"],
  ])("rejects cwd %s as outside the workspace", async (cwd: string) => {
    ownedWorkspace();
    const res = await POST(body({ projectId: "proj-alice", cwd }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe("cwd_outside_workspace");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allows a relative cwd inside the workspace", async () => {
    ownedWorkspace();
    const res = await POST(body({ projectId: "proj-alice", cwd: "src/components" }));

    expect(res.status).toBe(200);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string).cwd).toBe("src/components");
  });

  it("forwards the DERIVED workspaceId and the session user", async () => {
    ownedWorkspace();
    await POST(body({ command: "diff", projectId: "proj-alice" }));

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const sent = JSON.parse(init.body as string);
    expect(sent.workspaceId).toBe("ws-alice");
    expect(sent.userId).toBe("user_test");
    expect(sent.projectId).toBeUndefined();
  });

  it("accepts `git`, a real registry command the old list omitted", async () => {
    ownedWorkspace();
    const res = await POST(body({ command: "git", projectId: "proj-alice" }));

    expect(res.status).toBe(200);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string).command).toBe("git");
  });

  it.each([["read_file"], ["list_files"], ["log"], ["branch"], ["debug"], ["ship"], ["inspect_package"], ["do"], ["ask"]])(
    "rejects %s at the boundary because it is not a resolvable browser command",
    async (command) => {
      ownedWorkspace();
      const res = await POST(body({ command, projectId: "proj-alice" }));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe(`Unsupported command: ${command}`);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it("never contacts terminal-server when ownership validation fails", async () => {
    vi.mocked(verifyProjectWorkspace).mockRejectedValue(
      new FakeProjectVerificationError("Forbidden", "FORBIDDEN"),
    );
    const res = await POST(body({ projectId: "proj-bob" }));

    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not disclose a workspace root in any rejection body", async () => {
    ownedWorkspace();
    const res = await POST(
      body({ projectId: "proj-alice", cwd: "/data/littree-workspaces/user_bob/proj" }),
    );
    const raw = JSON.stringify(await res.json());

    expect(raw).not.toContain("/data/littree-workspaces");
    expect(raw).not.toContain("user_bob");
  });
});
