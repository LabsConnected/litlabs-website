/**
 * Clone inside the sandbox — Phase 2 lifecycle (design note §4.3).
 *
 * The host prepare path embeds the installation token in the clone
 * URL and rewrites the remote afterwards, treating a failed rewrite
 * as non-fatal. In a sandbox that is not good enough: a URL-embedded
 * token would land in `.git/config`, in the provider's command
 * history, and — via sync-back — on the shared volume. So here:
 *
 *   - The clone URL is the clean `https://github.com/<owner>/<repo>.git`
 *     from the start. The token travels ONLY as per-command env on
 *     the clone command (invariant: only a token minted through the
 *     web side's scoped path — readiness report §3.1 — may ever be
 *     handed to this function), and git reads it through an inline
 *     credential helper that echoes the env var. The token never
 *     appears in argv, so it never appears in a command string, an
 *     audit log, or a process list.
 *   - `git remote set-url origin <clean url>` still runs, for parity.
 *   - Verification is FATAL and precedes the first sync-back: the
 *     remote URL is read back and `.git/config` is scanned for the
 *     token value. Any hit destroys the caller's sandbox (the caller
 *     owns that decision — this module throws SandboxCloneVerificationError)
 *     and nothing syncs to the volume.
 *   - The token is redacted from every error this module produces.
 *
 * Input validation patterns are copied from the web side's
 * src/lib/terminal-v1/github-clone.ts (the terminal cannot import
 * from src/); keep the two in sync.
 *
 * Ruling (b): no write credential ever enters a sandbox. The token
 * accepted here is the read-only contents-scoped clone token; git
 * push runs web-side via the GitHub API, never from a sandbox.
 */

import type { SandboxProvider } from "./provider";
import { buildShellCommand, requireFileTransfer } from "./sync";

/** Per-command env var the credential helper reads the token from. */
export const GITHUB_TOKEN_ENV_VAR = "LITTREE_GITHUB_TOKEN";

/**
 * Inline credential helper: git runs it through a shell; it answers
 * with the fixed app username and the token FROM THE ENVIRONMENT.
 * The token value itself is not in this string.
 */
export const GITHUB_CREDENTIAL_HELPER =
  `!f() { echo "username=x-access-token"; echo "password=$${GITHUB_TOKEN_ENV_VAR}"; }; f`;

// ─── Validation (copied from src/lib/terminal-v1/github-clone.ts) ───

const OWNER_REPO_PATTERN = /^[A-Za-z0-9_.-]+$/;
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/;

export interface CloneTarget {
  owner: string;
  repo: string;
  branch: string;
}

/** Throw a descriptive Error when a clone input leaves the allowlist. */
export function validateCloneTarget(target: CloneTarget): void {
  const { owner, repo, branch } = target;
  if (!owner || !repo || !branch) {
    throw new Error("owner, repo, and branch are required for clone");
  }
  if (!OWNER_REPO_PATTERN.test(owner)) {
    throw new Error(`Invalid repository owner: ${JSON.stringify(owner)}`);
  }
  if (!OWNER_REPO_PATTERN.test(repo)) {
    throw new Error(`Invalid repository name: ${JSON.stringify(repo)}`);
  }
  if (!BRANCH_PATTERN.test(branch) || branch.startsWith("-")) {
    throw new Error(`Invalid branch name: ${JSON.stringify(branch)}`);
  }
}

export function cleanCloneUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}.git`;
}

/** Remove every occurrence of the token from text destined for logs/errors. */
export function redactToken(text: string, token: string | null | undefined): string {
  if (!token) return text;
  return text.split(token).join("***");
}

export class SandboxCloneError extends Error {
  readonly code = "SANDBOX_CLONE_FAILED" as const;
  constructor(message: string) {
    super(message);
    this.name = "SandboxCloneError";
  }
}

export class SandboxCloneVerificationError extends Error {
  readonly code = "SANDBOX_CLONE_VERIFICATION_FAILED" as const;
  constructor(message: string) {
    super(message);
    this.name = "SandboxCloneVerificationError";
  }
}

export interface CloneInSandboxInput extends CloneTarget {
  /** The scoped clone token (read-only contents), or null for public repos. */
  githubToken?: string | null;
  /** Sandbox-side workspace root ("/workspace"). */
  sandboxRoot: string;
  timeoutMs?: number;
}

export interface CloneInSandboxResult {
  commitSha: string;
}

/**
 * Clone into the sandbox root, sanitize, and verify — fatally.
 * On SandboxCloneVerificationError the caller MUST destroy the
 * sandbox and fail prepare without syncing anything back.
 */
export async function cloneInSandbox(
  provider: SandboxProvider,
  sandboxId: string,
  input: CloneInSandboxInput,
): Promise<CloneInSandboxResult> {
  validateCloneTarget(input);
  const token = input.githubToken ?? null;
  const url = cleanCloneUrl(input.owner, input.repo);
  const cwd = input.sandboxRoot;
  const timeoutMs = input.timeoutMs ?? 120_000;

  const argv: string[] = ["git"];
  if (token) {
    argv.push("-c", `credential.helper=${GITHUB_CREDENTIAL_HELPER}`);
  }
  argv.push("clone", "--depth", "1", "--branch", input.branch, url, ".");

  let cloneResult;
  try {
    cloneResult = await provider.execute(sandboxId, {
      command: buildShellCommand(argv),
      cwd,
      timeoutMs,
      ...(token ? { env: { [GITHUB_TOKEN_ENV_VAR]: token } } : {}),
    });
  } catch (err) {
    throw new SandboxCloneError(
      `Failed to clone ${input.owner}/${input.repo}:${input.branch}: ` +
        redactToken(err instanceof Error ? err.message : String(err), token),
    );
  }
  if (cloneResult.exitCode !== 0) {
    throw new SandboxCloneError(
      `Failed to clone ${input.owner}/${input.repo}:${input.branch} (exit ${cloneResult.exitCode}): ` +
        redactToken(cloneResult.stderr || cloneResult.stdout, token),
    );
  }

  // Parity with the host path: set the remote to the clean URL (it
  // already is — the clone never saw another form), then disable
  // auto-gc so packs are not rewritten between syncs (design §1.2).
  await sanitizeRemote(provider, sandboxId, input);

  await verifyCloneSanitized(provider, sandboxId, { ...input, githubToken: token });

  const head = await revParseHead(provider, sandboxId, cwd);
  return { commitSha: head };
}

/**
 * Point `origin` at the clean URL and set `gc.auto 0` in the sandbox
 * repo. Used after a fresh clone and after a volume mirror (where
 * the .git snapshot may carry an older remote form).
 */
export async function sanitizeRemote(
  provider: SandboxProvider,
  sandboxId: string,
  input: CloneTarget & { sandboxRoot: string },
): Promise<void> {
  const url = cleanCloneUrl(input.owner, input.repo);
  await provider.execute(sandboxId, {
    command: buildShellCommand(["git", "remote", "set-url", "origin", url]),
    cwd: input.sandboxRoot,
    timeoutMs: 30_000,
  });
  await provider.execute(sandboxId, {
    command: buildShellCommand(["git", "config", "gc.auto", "0"]),
    cwd: input.sandboxRoot,
    timeoutMs: 30_000,
  });
}

/**
 * The fatal verification (§4.3): read back `remote.origin.url` and
 * scan `.git/config` for the token value. Throws
 * SandboxCloneVerificationError on any discrepancy.
 */
export async function verifyCloneSanitized(
  provider: SandboxProvider,
  sandboxId: string,
  input: CloneInSandboxInput,
): Promise<void> {
  const token = input.githubToken ?? null;
  const expectedUrl = cleanCloneUrl(input.owner, input.repo);
  const cwd = input.sandboxRoot;

  const remote = await provider.execute(sandboxId, {
    command: buildShellCommand(["git", "config", "--get", "remote.origin.url"]),
    cwd,
    timeoutMs: 30_000,
  });
  const actualUrl = remote.stdout.trim();
  if (remote.exitCode !== 0 || actualUrl !== expectedUrl) {
    throw new SandboxCloneVerificationError(
      `Clone verification failed for ${input.owner}/${input.repo}: remote.origin.url is ` +
        `${JSON.stringify(redactToken(actualUrl, token))}, expected the clean URL.`,
    );
  }

  if (token) {
    const transfer = requireFileTransfer(provider);
    let configText = "";
    try {
      const bytes = await transfer.readFile(sandboxId, `${cwd}/.git/config`);
      configText = new TextDecoder().decode(bytes);
    } catch (err) {
      throw new SandboxCloneVerificationError(
        `Clone verification failed for ${input.owner}/${input.repo}: .git/config could not be read back: ` +
          redactToken(err instanceof Error ? err.message : String(err), token),
      );
    }
    if (configText.includes(token)) {
      throw new SandboxCloneVerificationError(
        `Clone verification failed for ${input.owner}/${input.repo}: the clone credential was found in .git/config.`,
      );
    }
    if (configText.includes(GITHUB_TOKEN_ENV_VAR) && configText.includes("credential")) {
      // The helper belongs on the command line only; a persisted
      // credential.helper in config would re-arm the token channel
      // on every later git call inside the sandbox.
      throw new SandboxCloneVerificationError(
        `Clone verification failed for ${input.owner}/${input.repo}: a credential helper was persisted in .git/config.`,
      );
    }
  }
}

/** `git rev-parse HEAD` inside the sandbox. Throws on failure. */
export async function revParseHead(
  provider: SandboxProvider,
  sandboxId: string,
  sandboxRoot: string,
): Promise<string> {
  const result = await provider.execute(sandboxId, {
    command: buildShellCommand(["git", "rev-parse", "HEAD"]),
    cwd: sandboxRoot,
    timeoutMs: 30_000,
  });
  const sha = result.stdout.trim();
  if (result.exitCode !== 0 || !/^[0-9a-fA-F]{7,64}$/.test(sha)) {
    throw new SandboxCloneError(
      `git rev-parse HEAD failed in sandbox (exit ${result.exitCode}): ${result.stderr.trim()}`,
    );
  }
  return sha;
}
