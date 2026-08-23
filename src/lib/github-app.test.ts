import { afterEach, describe, expect, it, vi } from "vitest";

describe("getInstallationTokenForClone", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("allows a credential-free clone only when GitHub confirms the repo is public", async () => {
    vi.stubEnv("GITHUB_APP_ID", '""');
    vi.stubEnv("GITHUB_PRIVATE_KEY", '""');
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ private: false }),
      }),
    );

    const { getInstallationTokenForClone } = await import("./github-app");

    await expect(
      getInstallationTokenForClone({
        installationId: 1,
        owner: "LabsConnected",
        repo: "litlabs-website",
      }),
    ).resolves.toBeNull();
  });

  it("preserves the GitHub App error for private repositories", async () => {
    vi.stubEnv("GITHUB_APP_ID", '""');
    vi.stubEnv("GITHUB_PRIVATE_KEY", '""');
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ private: true }),
      }),
    );

    const { getInstallationTokenForClone } = await import("./github-app");

    await expect(
      getInstallationTokenForClone({
        installationId: 1,
        owner: "LabsConnected",
        repo: "private-project",
      }),
    ).rejects.toThrow();
  });
});
