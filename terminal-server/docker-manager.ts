import { spawn } from "child_process";
import { mkdirSync } from "fs";
import { redactSecrets } from "./security";

interface DockerSessionOptions {
  userId: string;
  sessionId: string;
  workspace: string;
  onData: (data: string) => void;
}

export interface DockerSessionDeps {
  /** Injected in tests so no real `docker` process is ever started. */
  spawn?: typeof spawn;
}

/**
 * Start an interactive container session.
 *
 * Data safety: `workspace` is the user's REAL project directory, bind-mounted
 * read-write. It is never deleted by this module — not on normal exit, crash,
 * kill or spawn failure. The only resource this function owns and disposes of
 * is the container itself (`--rm`). Any future per-session scratch data must
 * live under a path this function created, never under `workspace`.
 *
 * Failure safety: spawn failures (docker binary missing, permission denied)
 * are reported via `error` events on the child process. Without a listener
 * Node throws them as uncaught exceptions and takes the whole terminal-server
 * down, so every emitter here has a handler and failure is surfaced to the
 * session as an explicit exit with a non-zero code.
 */
export function createDockerSession(
  { userId, sessionId, workspace, onData }: DockerSessionOptions,
  deps: DockerSessionDeps = {},
) {
  const spawnFn = deps.spawn ?? spawn;
  const image = process.env.DOCKER_TERMINAL_IMAGE || "littree-terminal:latest";
  const containerName = `littree-${userId.slice(0, 12)}-${sessionId.slice(0, 8)}`;

  mkdirSync(workspace, { recursive: true });

  const args = [
    "run",
    "--rm",
    "-i",
    "--name",
    containerName,
    "--network",
    "littree-terminal",
    "--cpus",
    "1.0",
    "--memory",
    "1g",
    "--pids-limit",
    "100",
    "--read-only",
    "--tmpfs",
    "/tmp:noexec,nosuid,size=100m",
    "-v",
    `${workspace}:/workspace:rw`,
    "-w",
    "/workspace",
    "-e",
    `LITTREE_USER_ID=${userId}`,
    "-e",
    `LITTREE_SESSION_ID=${sessionId}`,
    "-e",
    "HOME=/workspace",
    image,
    "/bin/bash",
  ];

  const proc = spawnFn("docker", args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      TERM: "xterm-256color",
    },
  });

  // Exit is reported exactly once, whether the process exits, crashes or
  // never starts.
  type ExitEvent = { exitCode: number; signal?: number };
  const exitCallbacks: Array<(ev: ExitEvent) => void> = [];
  let exited: ExitEvent | null = null;
  const finish = (ev: ExitEvent): void => {
    if (exited) return;
    exited = ev;
    for (const cb of exitCallbacks) {
      try { cb(ev); } catch { /* a listener must not break teardown */ }
    }
  };

  proc.stdout?.on("data", (chunk) => {
    onData(redactSecrets(chunk.toString()));
  });

  proc.stderr?.on("data", (chunk) => {
    onData(redactSecrets(chunk.toString()));
  });

  // Spawn failure (ENOENT/EACCES) and any later process-level error.
  proc.on("error", (err) => {
    console.error(`[Docker] Session ${sessionId} process error: ${err.message}`);
    onData(`\r\n[terminal unavailable: container runtime error]\r\n`);
    finish({ exitCode: 127 });
  });

  // A write to a dead child raises EPIPE on stdin; swallow it here.
  proc.stdin?.on("error", () => { /* session is ending */ });
  proc.stdout?.on("error", () => { /* session is ending */ });
  proc.stderr?.on("error", () => { /* session is ending */ });

  proc.on("exit", (code, signal) => {
    console.log(`[Docker] Session ${sessionId} exited with code ${code}`);
    const signalNum = signal ? Number(signal) : undefined;
    finish({ exitCode: code ?? 0, signal: Number.isNaN(signalNum) ? undefined : signalNum });
  });

  return {
    pid: proc.pid ?? 0,
    write: (data: string) => {
      if (exited || !proc.stdin || proc.stdin.destroyed) return;
      try { proc.stdin.write(data); } catch { /* session is ending */ }
    },
    resize: () => {
      // Docker exec resize is not trivial without a TTY; ignored for now.
    },
    kill: () => {
      try { proc.kill("SIGTERM"); } catch { /* already gone */ }
      setTimeout(() => {
        if (!exited) {
          try { proc.kill("SIGKILL"); } catch { /* already gone */ }
        }
      }, 5000).unref?.();
    },
    onData: (callback: (data: string) => void) => {
      proc.stdout?.on("data", (chunk) => callback(redactSecrets(chunk.toString())));
      proc.stderr?.on("data", (chunk) => callback(redactSecrets(chunk.toString())));
    },
    onExit: (callback: (ev: ExitEvent) => void) => {
      if (exited) callback(exited);
      else exitCallbacks.push(callback);
    },
  } as unknown as import("node-pty").IPty;
}

export function ensureDockerNetwork(): void {
  const proc = spawn("docker", ["network", "inspect", "littree-terminal"], { stdio: "ignore" });
  // Missing docker binary must not crash the server.
  proc.on("error", (err) => console.error(`[Docker] network inspect failed: ${err.message}`));
  proc.on("exit", (code) => {
    if (code !== 0) {
      const create = spawn("docker", ["network", "create", "littree-terminal"], { stdio: "inherit" });
      create.on("error", (err) => console.error(`[Docker] network create failed: ${err.message}`));
    }
  });
}
