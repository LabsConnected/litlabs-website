import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkCommandForWorkspace,
  type ProjectPackageInfo,
} from "@/lib/litt-intelligence/workspace-transport";

// The reachability probe is what these tests exercise; the DB-backed
// workspace verification is stubbed so no live Supabase is needed.
vi.mock("@/lib/projects/project-repository", () => ({
  verifyProjectWorkspace: vi.fn().mockResolvedValue({
    workspaceId: "ws-test",
    workspaceRoot: "/tmp/ws-test",
    project: { name: "test-project" },
  }),
}));

function makeInfo(overrides: Partial<ProjectPackageInfo> = {}): ProjectPackageInfo {
  return {
    packageManager: "npm",
    scripts: {},
    hasPackageJson: true,
    hasTypecheck: false,
    hasLint: false,
    hasBuild: false,
    hasTest: false,
    ...overrides,
  };
}

describe("checkCommandForWorkspace", () => {
  it("skips typecheck entirely on a static workspace (no package.json)", () => {
    // Regression: golden acceptance failed because a static Ember Roast
    // workspace fell back to `npm exec tsc --noEmit`, which exited 1 with no
    // output and burned all three repair attempts before deploy.
    const staticInfo = makeInfo({ hasPackageJson: false });
    expect(checkCommandForWorkspace("typecheck", staticInfo)).toBeNull();
    expect(checkCommandForWorkspace("lint", staticInfo)).toBeNull();
    expect(checkCommandForWorkspace("test", staticInfo)).toBeNull();
    expect(checkCommandForWorkspace("build", staticInfo)).toBeNull();
  });

  it("runs `pm run typecheck` when a typecheck script exists", () => {
    const info = makeInfo({ hasTypecheck: true });
    expect(checkCommandForWorkspace("typecheck", info)).toBe("npm run typecheck");
  });

  it("falls back to `pm exec tsc --noEmit` when package.json exists without a typecheck script", () => {
    const info = makeInfo({ packageManager: "pnpm" });
    expect(checkCommandForWorkspace("typecheck", info)).toBe(
      "pnpm exec tsc --noEmit",
    );
  });

  it("skips build/lint/test when their scripts are absent", () => {
    const info = makeInfo();
    expect(checkCommandForWorkspace("build", info)).toBeNull();
    expect(checkCommandForWorkspace("lint", info)).toBeNull();
    expect(checkCommandForWorkspace("test", info)).toBeNull();
  });

  it("uses the detected package manager in run commands", () => {
    const info = makeInfo({ packageManager: "yarn", hasBuild: true, hasTest: true });
    expect(checkCommandForWorkspace("build", info)).toBe("yarn run build");
    expect(checkCommandForWorkspace("test", info)).toBe("yarn run test");
  });
});

describe("gitStatus — porcelain rename and quoting", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.TERMINAL_AUTH_SECRET = "x".repeat(32);
    process.env.TERMINAL_PUBLIC_URL = "http://terminal.test";
    process.env.TERMINAL_INTERNAL_SERVICE_KEY = "test-service-key";
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  // Probe answers ok; the exec call returns the canned porcelain output.
  async function transportWithPorcelain(porcelain: string) {
    globalThis.fetch = vi.fn().mockImplementation(async (url: unknown) => {
      if (String(url).includes("/exec")) {
        return {
          ok: true,
          json: () => Promise.resolve({ exitCode: 0, stdout: porcelain, stderr: "" }),
        };
      }
      return { ok: true, json: () => Promise.resolve({ entries: [] }) };
    });
    const { createWorkspaceTransport } = await import(
      "@/lib/litt-intelligence/workspace-transport"
    );
    return createWorkspaceTransport("proj-1", "user-1");
  }

  it("keeps the full post-image name when a rename destination contains ' -> '", async () => {
    const transport = await transportWithPorcelain("## main\nR  old.txt -> a -> b.txt");
    const status = await transport.gitStatus();
    expect(status.staged).toEqual([{ path: "a -> b.txt", status: "R " }]);
  });

  it("does not truncate a non-rename filename that contains ' -> '", async () => {
    const transport = await transportWithPorcelain("## main\n M a -> b.txt");
    const status = await transport.gitStatus();
    expect(status.modified).toEqual([{ path: "a -> b.txt", status: " M" }]);
  });

  it("splits at the first arrow OUTSIDE quotes — a quoted source name can contain ' -> '", async () => {
    const transport = await transportWithPorcelain('## main\nR  "a -> old.txt" -> new.txt');
    const status = await transport.gitStatus();
    expect(status.staged).toEqual([{ path: "new.txt", status: "R " }]);
  });

  it("decodes core.quotePath octal escapes in rename destinations", async () => {
    const transport = await transportWithPorcelain(
      '## main\nR  "caf\\303\\251.txt" -> "renamed-\\303\\251.txt"',
    );
    const status = await transport.gitStatus();
    expect(status.staged).toEqual([{ path: "renamed-é.txt", status: "R " }]);
  });

  it("decodes quoted non-rename paths in porcelain status", async () => {
    const transport = await transportWithPorcelain('## main\n M "caf\\303\\251.txt"');
    const status = await transport.gitStatus();
    expect(status.modified).toEqual([{ path: "café.txt", status: " M" }]);
  });
});

describe("createWorkspaceTransport — reachability probe", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.TERMINAL_AUTH_SECRET = "x".repeat(32);
    process.env.TERMINAL_PUBLIC_URL = "http://terminal.test";
  });

  afterEach(() => {
    // Restore only the fetch stub. Do NOT call vi.restoreAllMocks() here —
    // it would reset the verifyProjectWorkspace module mock's implementation
    // to return undefined for the remaining tests.
    globalThis.fetch = realFetch;
  });

  it("marks fileOpsReachable false when /ws-files is unreachable", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("signal timed out"));
    const { createWorkspaceTransport } = await import(
      "@/lib/litt-intelligence/workspace-transport"
    );
    const transport = await createWorkspaceTransport("proj-1", "user-1");
    expect(transport.fileOpsReachable).toBe(false);
  });

  it("marks fileOpsReachable false when /ws-files returns an error", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) });
    const { createWorkspaceTransport } = await import(
      "@/lib/litt-intelligence/workspace-transport"
    );
    const transport = await createWorkspaceTransport("proj-1", "user-1");
    expect(transport.fileOpsReachable).toBe(false);
  });

  it("marks fileOpsReachable true when /ws-files answers", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ entries: [] }) });
    const { createWorkspaceTransport } = await import(
      "@/lib/litt-intelligence/workspace-transport"
    );
    const transport = await createWorkspaceTransport("proj-1", "user-1");
    expect(transport.fileOpsReachable).toBe(true);
  });
});
