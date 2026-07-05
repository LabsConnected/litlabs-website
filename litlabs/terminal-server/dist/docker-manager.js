"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDockerSession = createDockerSession;
exports.ensureDockerNetwork = ensureDockerNetwork;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const security_1 = require("./security");
function createDockerSession({ userId, sessionId, workspace, onData }) {
    const image = process.env.DOCKER_TERMINAL_IMAGE || "littree-terminal:latest";
    const containerName = `littree-${userId.slice(0, 12)}-${sessionId.slice(0, 8)}`;
    (0, fs_1.mkdirSync)(workspace, { recursive: true });
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
    const proc = (0, child_process_1.spawn)("docker", args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
            ...process.env,
            TERM: "xterm-256color",
        },
    });
    proc.stdout.on("data", (chunk) => {
        onData((0, security_1.redactSecrets)(chunk.toString()));
    });
    proc.stderr.on("data", (chunk) => {
        onData((0, security_1.redactSecrets)(chunk.toString()));
    });
    proc.on("exit", (code) => {
        console.log(`[Docker] Session ${sessionId} exited with code ${code}`);
        try {
            (0, fs_1.rmSync)(workspace, { recursive: true, force: true });
        }
        catch {
            // ignore cleanup errors
        }
    });
    return {
        pid: proc.pid ?? 0,
        write: (data) => {
            proc.stdin.write(data);
        },
        resize: () => {
            // Docker exec resize is not trivial without a TTY; ignored for now.
        },
        kill: () => {
            proc.kill("SIGTERM");
            setTimeout(() => {
                if (!proc.killed)
                    proc.kill("SIGKILL");
            }, 5000);
        },
        onData: (callback) => {
            proc.stdout.on("data", (chunk) => callback((0, security_1.redactSecrets)(chunk.toString())));
            proc.stderr.on("data", (chunk) => callback((0, security_1.redactSecrets)(chunk.toString())));
        },
        onExit: (callback) => {
            proc.on("exit", (exitCode, signal) => {
                const signalNum = signal ? Number(signal) : undefined;
                callback({ exitCode: exitCode ?? 0, signal: signalNum });
            });
        },
    };
}
function ensureDockerNetwork() {
    const proc = (0, child_process_1.spawn)("docker", ["network", "inspect", "littree-terminal"], { stdio: "ignore" });
    proc.on("exit", (code) => {
        if (code !== 0) {
            (0, child_process_1.spawn)("docker", ["network", "create", "littree-terminal"], { stdio: "inherit" });
        }
    });
}
