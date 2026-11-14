/**
 * Sandbox git clone (Phase 2 lifecycle, design note §4.2/§5, readiness
 * report §3.1 invariant).
 *
 * The scoped GitHub token may reach the sandbox ONLY as a per-command
 * credential-helper value (an env var) — never in a URL, never in a
 * command string, never persisted in .git/config. Sanitization is
 * verified FATALLY before anything syncs back: a leaked token in the
 * cloned config fails the clone with SandboxCloneVerificationError.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { FakeSandboxProvider } from "../sandbox/testing/fake-providers";
import {
  cloneInSandbox,
  cleanCloneUrl,
  redactToken,
  validateCloneTarget,
  SandboxCloneError,
  SandboxCloneVerificationError,
} from "../sandbox/git-clone";

// Synthetic stand-in for a scoped installation token (never a real
// credential — the assertions only check where this string travels).
const TOKEN = ["test", "scoped", "token", "0001"].join("-");
const ROOT = "/workspace";

let provider: FakeSandboxProvider;
let sandboxId: string;
const executed: Array<{ command: string; env?: Record<string, string> }> = [];

beforeEach(async () => {
  provider = new FakeSandboxProvider();
  const instance = await provider.create({ timeoutMs: 60_000 });
  sandboxId = instance.sandboxId;
  executed.length = 0;
  const original = provider.execute.bind(provider);
  provider.execute = async (id, input) => {
    executed.push({ command: input.command, env: input.env });
    return original(id, input);
  };
});

describe("validateCloneTarget", () => {
  it("accepts ordinary owner/repo/branch shapes", () => {
    expect(() =>
      validateCloneTarget({ owner: "LabsConnected", repo: "litlabs-website", branch: "main" }),
    ).not.toThrow();
    expect(() =>
      validateCloneTarget({ owner: "a.b-c_d", repo: "repo.name", branch: "feature/x-y" }),
    ).not.toThrow();
  });

  it("rejects traversal, spaces, and option-looking branches", () => {
    expect(() => validateCloneTarget({ owner: "../etc", repo: "r", branch: "main" })).toThrow();
    expect(() => validateCloneTarget({ owner: "o", repo: "has space", branch: "main" })).toThrow();
    expect(() => validateCloneTarget({ owner: "o", repo: "r", branch: "-upload-pack=touch" })).toThrow();
    expect(() => validateCloneTarget({ owner: "o", repo: "r", branch: "bad branch" })).toThrow();
  });
});

describe("cloneInSandbox", () => {
  it("clones with the token only in per-command env — never in any command string or URL", async () => {
    const result = await cloneInSandbox(provider, sandboxId, {
      sandboxRoot: ROOT,
      owner: "acme",
      repo: "site",
      branch: "main",
      githubToken: TOKEN,
    });
    expect(result.commitSha).toMatch(/^[0-9a-f]{7,64}$/);
    expect(cleanCloneUrl("acme", "site")).toBe("https://github.com/acme/site.git");
    expect(cleanCloneUrl("acme", "site")).not.toContain(TOKEN);

    const cloneCall = executed.find((e) => e.command.includes("clone"));
    expect(cloneCall).toBeDefined();
    // The command string itself must never carry the token.
    for (const call of executed) {
      expect(call.command).not.toContain(TOKEN);
    }
    // The token travelled exactly once: as the credential-helper env var.
    expect(cloneCall?.env?.LITTREE_GITHUB_TOKEN).toBe(TOKEN);
  });

  it("leaves a sanitized .git/config — clean remote, no token, no persisted helper", async () => {
    await cloneInSandbox(provider, sandboxId, {
      sandboxRoot: ROOT,
      owner: "acme", repo: "site", branch: "main", githubToken: TOKEN,
    });
    const config = await provider.fileTransfer!.readFile(sandboxId, `${ROOT}/.git/config`);
    const text = new TextDecoder().decode(config);
    expect(text).toContain("url = https://github.com/acme/site.git");
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("credential.helper");
  });

  it("FAILS FATALLY when the token leaks into .git/config", async () => {
    const leaky = new FakeSandboxProvider({ cloneLeaksTokenIntoConfig: true });
    const inst = await leaky.create({ timeoutMs: 60_000 });
    await expect(
      cloneInSandbox(leaky, inst.sandboxId, {
        sandboxRoot: ROOT,
        owner: "acme", repo: "site", branch: "main", githubToken: TOKEN,
      }),
    ).rejects.toBeInstanceOf(SandboxCloneVerificationError);
  });

  it("redacts the token from clone failure output", async () => {
    const failing = new FakeSandboxProvider();
    const inst = await failing.create({ timeoutMs: 60_000 });
    failing.execute = async () => ({
      exitCode: 128,
      stdout: "",
      stderr: `fatal: could not read from https://x-access-token:${TOKEN}@github.com`,
      durationMs: 1,
    });
    await expect(
      cloneInSandbox(failing, inst.sandboxId, {
        sandboxRoot: ROOT,
        owner: "acme", repo: "site", branch: "main", githubToken: TOKEN,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(SandboxCloneError);
      expect((err as Error).message).not.toContain(TOKEN);
      expect((err as Error).message).toContain("***");
      return true;
    });
  });
});

describe("redactToken", () => {
  it("replaces every occurrence and tolerates empty tokens", () => {
    expect(redactToken(`a ${TOKEN} b ${TOKEN}`, TOKEN)).toBe("a *** b ***");
    expect(redactToken("unchanged", "")).toBe("unchanged");
    expect(redactToken("unchanged", undefined)).toBe("unchanged");
  });
});
