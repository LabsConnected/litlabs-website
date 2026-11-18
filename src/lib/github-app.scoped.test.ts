import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Phase 2 build-list fix #1 — clone-token scoping pins.
 *
 * getInstallationTokenForClone is the one credential path that may be
 * handed to a sandbox, so its token MUST be minted scoped to the
 * single repository (repositoryIds: [repoId]) with read-only contents
 * permission. These tests pin the exact auth arguments; the unscoped
 * installation mint (repositoryIds/permissions absent) must never
 * serve the clone path.
 */

const authMock = vi.fn();
vi.mock("@octokit/auth-app", () => ({
  createAppAuth: vi.fn(() => authMock),
}));

async function loadModule() {
  vi.resetModules();
  return import("@/lib/github-app");
}

const PRIVATE_REPO = { id: 424242, private: true };
const PUBLIC_REPO = { id: 434343, private: false };

function stubFetchOk(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GITHUB_APP_ID", "12345");
  vi.stubEnv("GITHUB_PRIVATE_KEY", "test-key");
  // Default: the app JWT mint succeeds; installation mints are asserted
  // per test.
  authMock.mockImplementation(async (opts: { type: string }) => {
    if (opts.type === "app") return { token: "app-jwt" };
    return { token: "installation-token" };
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getInstallationTokenForClone — scoped minting", () => {
  it("mints the clone token scoped to the repo id with contents:read", async () => {
    stubFetchOk(PRIVATE_REPO);
    const { getInstallationTokenForClone } = await loadModule();
    const token = await getInstallationTokenForClone({
      installationId: 99,
      owner: "owner",
      repo: "repo",
    });
    expect(token).toBe("installation-token");
    expect(authMock).toHaveBeenCalledWith({
      type: "installation",
      installationId: 99,
      repositoryIds: [424242],
      permissions: { contents: "read" },
    });
  });

  it("never calls the unscoped installation mint on the clone path", async () => {
    stubFetchOk(PRIVATE_REPO);
    const { getInstallationTokenForClone } = await loadModule();
    await getInstallationTokenForClone({ installationId: 99, owner: "owner", repo: "repo" });
    for (const call of authMock.mock.calls) {
      const arg = call[0] as { type?: string; repositoryIds?: unknown };
      if (arg.type === "installation") {
        expect(arg.repositoryIds).toEqual([424242]);
      }
    }
  });

  it("returns null for a confirmed public repository when the scoped mint fails", async () => {
    stubFetchOk(PUBLIC_REPO);
    authMock.mockImplementation(async (opts: { type: string }) => {
      if (opts.type === "app") return { token: "app-jwt" };
      throw new Error("bad credentials");
    });
    const { getInstallationTokenForClone } = await loadModule();
    await expect(
      getInstallationTokenForClone({ installationId: 99, owner: "owner", repo: "repo" }),
    ).resolves.toBeNull();
  });

  it("fails closed for a private repository when the scoped mint fails", async () => {
    stubFetchOk(PRIVATE_REPO);
    authMock.mockImplementation(async (opts: { type: string }) => {
      if (opts.type === "app") return { token: "app-jwt" };
      throw new Error("bad credentials");
    });
    const { getInstallationTokenForClone } = await loadModule();
    await expect(
      getInstallationTokenForClone({ installationId: 99, owner: "owner", repo: "repo" }),
    ).rejects.toThrow("bad credentials");
  });

  it("refuses to mint when no repository id can be resolved (no unscoped fallback)", async () => {
    // Metadata endpoint 404s under both the app JWT and anonymously,
    // while the app credentials themselves are valid.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 })),
    );
    const { getInstallationTokenForClone } = await loadModule();
    await expect(
      getInstallationTokenForClone({ installationId: 99, owner: "owner", repo: "repo" }),
    ).rejects.toThrow(/refusing to mint an unscoped token/);
    for (const call of authMock.mock.calls) {
      expect((call[0] as { type?: string }).type).not.toBe("installation");
    }
  });
});
