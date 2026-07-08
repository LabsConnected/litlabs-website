import { spawn } from "child_process";
import { mkdirSync, rmSync } from "fs";
import { redactSecrets } from "./security";

interface DockerSessionOptions {
  userId: string;
  sessionId: string;
  workspace: string;
  cwd?: string;
  env?: Record<string, string>;
  onData: (data: string) => void;
}

export function createDockerSession({ userId, sessionId, workspace, cwd, env, onData }: DockerSessionOptions) {
  const image = process.env.DOCKER_TERMINAL_IMAGE || "littree-terminal:latest";
  const containerName = `littree-${userId.slice(0, 12)}-${sessionId.slice(0, 8)}`;

  mkdirSync(workspace, { recursive: true });

  const workDir = cwd || "/workspace";

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
    workDir,
    "-e",
    `LITTREE_USER_ID=${userId}`,
    "-e",
    `LITTREE_SESSION_ID=${sessionId}`,
    "-e",
    `HOME=${workDir}`,
  ];

  if (env) {
    for (const [key, value] of Object.entries(env)) {
      args.push("-e", `${key}=${value}`);
    }
  }

  args.push(image, "/bin/bash");

  const proc = spawn("docker", args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ...env,
      TERM: "xterm-256color",
    },
  });

  proc.stdout.on("data", (chunk) => {
    onData(redactSecrets(chunk.toString()));
  });

  proc.stderr.on("data", (chunk) => {
    onData(redactSecrets(chunk.toString()));
  });

  proc.on("exit", (code) => {
    console.log(`[Docker] Session ${sessionId} exited with code ${code}`);
    try {
      rmSync(workspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  return {
    pid: proc.pid ?? 0,
    write: (data: string) => {
      proc.stdin.write(data);
    },
    resize: () => {
      // Docker exec resize is not trivial without a TTY; ignored for now.
    },
    kill: () => {
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL");
      }, 5000);
    },
    onData: (callback: (data: string) => void) => {
      proc.stdout.on("data", (chunk) => callback(redactSecrets(chunk.toString())));
      proc.stderr.on("data", (chunk) => callback(redactSecrets(chunk.toString())));
    },
    onExit: (callback: (ev: { exitCode: number; signal?: number }) => void) => {
      proc.on("exit", (exitCode, signal) => {
        const signalNum = signal ? Number(signal) : undefined;
        callback({ exitCode: exitCode ?? 0, signal: signalNum });
      });
    },
  } as unknown as import("node-pty").IPty;
}

export function ensureDockerNetwork(): void {
  const proc = spawn("docker", ["network", "inspect", "littree-terminal"], { stdio: "ignore" });
  proc.on("exit", (code) => {
    if (code !== 0) {
      spawn("docker", ["network", "create", "littree-terminal"], { stdio: "inherit" });
    }
  });
}
