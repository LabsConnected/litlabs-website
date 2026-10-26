/**
 * Dex JSON report builders — the same data the console verbs print,
 * as structured objects for the agent's HTTP API. Reuses every Stage
 * 1A module; never spawns anything the verb wouldn't.
 */

import { collectMetrics } from "./metrics.js";
import { listProcesses } from "./processes.js";
import { detectProject, resolveProjectCwd } from "../utils.js";
import { getGitState } from "../git-state.js";
import { probeLocalLane } from "../local-lane.js";

export async function reportCpu() {
  const m = await collectMetrics();
  return { cpu: m.cpu, uptimeSec: m.uptimeSec };
}

export async function reportRam() {
  const m = await collectMetrics();
  return { memory: m.memory };
}

export async function reportProcs() {
  return listProcesses({ limit: 15 });
}

export async function reportOllama() {
  const lane = await probeLocalLane();
  return {
    available: lane.available,
    endpoint: lane.endpoint,
    route: lane.route ?? null,
    routeLabel: lane.routeLabel ?? "",
    models: lane.models,
    reason: lane.reason,
  };
}

export function reportProject() {
  const detected = detectProject(resolveProjectCwd());
  const git = getGitState(detected.rootDir);
  return {
    name: String(detected.packageJson?.name ?? detected.dirName),
    root: detected.rootDir,
    git: git.isGitRepo
      ? { branch: git.branch, changed: git.changed, untracked: git.untracked, clean: git.clean }
      : null,
  };
}

export async function reportStatus() {
  const m = await collectMetrics();
  const [procs, ollama] = await Promise.all([reportProcs(), reportOllama()]);
  return {
    host: { hostname: m.hostname, platform: m.platform, arch: m.arch, uptimeSec: m.uptimeSec },
    cpu: m.cpu,
    memory: m.memory,
    procs,
    ollama,
    project: reportProject(),
    agent: { rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024) },
  };
}
