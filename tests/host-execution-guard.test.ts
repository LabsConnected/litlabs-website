/**
 * Security Gate 1 — web-app host-execution guard.
 *
 * terminal-server/__tests__/host-execution-guard.test.ts proves the policy
 * inside terminal-server. This file covers the Next.js web app, which has its
 * own routes and libraries that start child processes on the web host.
 *
 *   1. The guard module fails closed in production-like environments, with no
 *      override, and agrees with terminal-server/isolation-policy.ts.
 *   2. A static inventory of every `src/` file that can start a host process.
 *      Each is either guarded or reviewed-and-reachable-only-through-a-guard.
 *      A new, unreviewed spawn site fails this test.
 *   3. Container hardening flags / image tag regressions.
 *
 * Run: npx vitest run tests/host-execution-guard.test.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  HOST_EXECUTION_DISABLED_CODE,
  hostExecutionBlockedResponse,
  isHostExecutionPermitted,
  isProductionLike,
} from "../src/lib/host-execution-guard";
import { isProductionLike as terminalIsProductionLike } from "../terminal-server/isolation-policy";

const ROOT = process.cwd();

// ─── 1. Guard behaviour ─────────────────────────────────────────────

const RAILWAY_MARKERS = [
  "RAILWAY_ENVIRONMENT_ID",
  "RAILWAY_PROJECT_ID",
  "RAILWAY_SERVICE_ID",
  "RAILWAY_GIT_COMMIT_SHA",
];
const VERCEL_MARKERS = ["VERCEL", "VERCEL_ENV", "VERCEL_URL"];

const LOCAL = {
  NODE_ENV: "development",
  LITT_ALLOW_LOCAL_HOST_EXEC: "1",
  LITT_RESOLVED_BIND_HOST: "127.0.0.1",
};

describe("isProductionLike (web app)", () => {
  it("treats NODE_ENV=production as production", () => {
    expect(isProductionLike({ NODE_ENV: "production" })).toBe(true);
  });

  it.each([...RAILWAY_MARKERS, ...VERCEL_MARKERS])(
    "treats %s as production even when NODE_ENV says development",
    (marker) => {
      expect(isProductionLike({ ...LOCAL, [marker]: "1" })).toBe(true);
      expect(isProductionLike({ [marker]: "1" })).toBe(true);
    },
  );

  it("treats only explicit opted-in, loopback-bound development/test as local", () => {
    expect(isProductionLike(LOCAL)).toBe(false);
    expect(isProductionLike({ ...LOCAL, NODE_ENV: "test" })).toBe(false);
    expect(isProductionLike({ ...LOCAL, LITT_RESOLVED_BIND_HOST: "::1" })).toBe(false);
    expect(isProductionLike({ ...LOCAL, LITT_RESOLVED_BIND_HOST: "localhost" })).toBe(false);
  });

  it("NODE_ENV=development/test alone is NOT sufficient authorization", () => {
    expect(isHostExecutionPermitted({ NODE_ENV: "development" })).toBe(false);
    expect(isHostExecutionPermitted({ NODE_ENV: "test" })).toBe(false);
  });

  it("requires the exact opt-in value", () => {
    for (const v of [undefined, "", "0", "true", "yes", " 1", "1 "]) {
      expect(isHostExecutionPermitted({ ...LOCAL, LITT_ALLOW_LOCAL_HOST_EXEC: v }), String(v)).toBe(false);
    }
  });

  it("requires a verified loopback bind: unknown or remotely reachable binds deny", () => {
    for (const host of [undefined, "", "0.0.0.0", "::", "192.168.1.20", "100.101.102.103", "example.com", "127.0.0.1.evil.com"]) {
      expect(isHostExecutionPermitted({ ...LOCAL, LITT_RESOLVED_BIND_HOST: host }), String(host)).toBe(false);
    }
  });

  it("is default-deny: missing or unrecognised NODE_ENV never permits execution", () => {
    for (const NODE_ENV of [undefined, "", "prod", "Production", "staging", "preview", " development", "dev"]) {
      const env = NODE_ENV === undefined
        ? { LITT_ALLOW_LOCAL_HOST_EXEC: "1", LITT_RESOLVED_BIND_HOST: "127.0.0.1" }
        : { ...LOCAL, NODE_ENV };
      expect(isHostExecutionPermitted(env), JSON.stringify(env)).toBe(false);
      expect(hostExecutionBlockedResponse("x", env), JSON.stringify(env)).not.toBeNull();
    }
  });

  it("is not unlocked by any override-style variable", () => {
    const env = {
      NODE_ENV: "production",
      TERMINAL_VERIFIED_ISOLATION: "true",
      TERMINAL_USE_DOCKER: "true",
      TERMINAL_PROVIDER: "managed-sandbox",
      TERMINAL_ENABLED: "true",
      ENABLE_AGENT_COMMANDS: "true",
      ENABLE_LOCAL_BUILD_API: "true",
      ALLOW_HOST_EXECUTION: "true",
    };
    expect(isProductionLike(env)).toBe(true);
    expect(isHostExecutionPermitted(env)).toBe(false);
    expect(hostExecutionBlockedResponse("x", env)).not.toBeNull();
  });

  it("agrees with terminal-server/isolation-policy.ts on the full environment matrix", () => {
    const envs: Array<Record<string, string | undefined>> = [
      { NODE_ENV: "production" },
      { ...LOCAL, NODE_ENV: "production" },
      LOCAL,
      { ...LOCAL, NODE_ENV: "test" },
      { NODE_ENV: "development" },
      { ...LOCAL, LITT_RESOLVED_BIND_HOST: "0.0.0.0" },
      { ...LOCAL, LITT_ALLOW_LOCAL_HOST_EXEC: undefined },
      ...[...RAILWAY_MARKERS, ...VERCEL_MARKERS].flatMap((m) => [{ [m]: "1" }, { ...LOCAL, [m]: "1" }]),
    ];
    for (const env of envs) {
      expect(isProductionLike(env), JSON.stringify(env)).toBe(terminalIsProductionLike(env));
    }
  });
});

describe("hostExecutionBlockedResponse", () => {
  it("returns null in explicit local development so existing behaviour is preserved", () => {
    expect(hostExecutionBlockedResponse("bridge-cli", LOCAL)).toBeNull();
    expect(hostExecutionBlockedResponse("bridge-cli", { ...LOCAL, NODE_ENV: "test" })).toBeNull();
    expect(hostExecutionBlockedResponse("bridge-cli", { NODE_ENV: "development" })).not.toBeNull();
  });

  it("returns 503 HOST_EXECUTION_DISABLED naming the surface in production", async () => {
    const res = hostExecutionBlockedResponse("bridge-cli", { NODE_ENV: "production" });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
    expect(res!.headers.get("cache-control")).toBe("no-store");
    const body = await res!.json();
    expect(body.code).toBe(HOST_EXECUTION_DISABLED_CODE);
    expect(body.code).toBe("HOST_EXECUTION_DISABLED");
    expect(body.error).toContain("bridge-cli");
  });

  it("reads process.env at call time, not at import time", () => {
    const keys = ["NODE_ENV", "LITT_ALLOW_LOCAL_HOST_EXEC", "LITT_RESOLVED_BIND_HOST"];
    const e = process.env as Record<string, string | undefined>;
    const before = keys.map((k) => e[k]);
    const restore = () => keys.forEach((k, i) => (before[i] === undefined ? delete e[k] : (e[k] = before[i])));
    try {
      Object.assign(e, LOCAL, { NODE_ENV: "production" });
      expect(isHostExecutionPermitted()).toBe(false);
      Object.assign(e, LOCAL, { NODE_ENV: "test" });
      expect(isHostExecutionPermitted()).toBe(true);
      delete e.LITT_ALLOW_LOCAL_HOST_EXEC;
      expect(isHostExecutionPermitted()).toBe(false);
    } finally {
      restore();
    }
  });
});

// ─── 2. Static inventory of host-execution sites in src/ ─────────────

/** Imports that give a file the ability to start a process on the host. */
const EXEC_IMPORT_PATTERNS: RegExp[] = [
  /from\s+["'](?:node:)?child_process["']/,
  /require\(\s*["'](?:node:)?child_process["']\s*\)/,
  /from\s+["'](?:execa|cross-spawn|shelljs|simple-git|node-pty)["']/,
];

/** Files that start host processes and carry their own production guard. */
const GUARDED_FILES: Record<string, RegExp[]> = {
  "src/app/api/bridge/cli/route.ts": [/hostExecutionBlockedResponse\("bridge-cli"\)/],
  "src/app/api/agents/execute/route.ts": [/hostExecutionBlockedResponse\("agents-execute"\)/],
  "src/app/api/litt/command/route.ts": [/hostExecutionBlockedResponse\("litt-command"\)/],
  "src/app/api/agents/commits/route.ts": [/isHostExecutionPermitted\(\)/],
  "src/app/api/litt/scan/route.ts": [/isHostExecutionPermitted\(\)/],
  "src/lib/litt-intelligence/project-scanner.ts": [/isHostExecutionPermitted\(\)/],
  "src/lib/visual-builds/capture.ts": [/isHostExecutionPermitted\(\)/],
  "src/lib/terminal-v1/github-clone.ts": [/isHostExecutionPermitted\(\)/],
};

/**
 * Files that start host processes but are only reachable through a guarded
 * entry point. `viaGuard` is the file that must hold the guard, and
 * `importers` is the exact set of non-test files allowed to import the module.
 */
const REACHABLE_ONLY_VIA_GUARD: Record<
  string,
  { viaGuard: string; guardMarker: RegExp; importPattern: RegExp; importers: string[] }
> = {
  "src/lib/command-executor.ts": {
    viaGuard: "src/app/api/agents/execute/route.ts",
    guardMarker: /hostExecutionBlockedResponse\("agents-execute"\)/,
    importPattern: /["']@\/lib\/command-executor["']|["']\.\/command-executor["']/,
    importers: ["src/app/api/agents/execute/route.ts"],
  },
  "src/lib/terminal-v1/providers/docker-provider.ts": {
    viaGuard: "src/lib/terminal-v1/providers/index.ts",
    guardMarker: /isProductionLike\(\)/,
    importPattern: /["']\.\/docker-provider["']|["']@\/lib\/terminal-v1\/providers\/docker-provider["']/,
    importers: ["src/lib/terminal-v1/providers/index.ts"],
  },
};

function isTestFile(rel: string): boolean {
  return /\.test\.tsx?$/.test(rel) || /\.spec\.tsx?$/.test(rel) || rel.includes("/__tests__/");
}

function listSources(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listSources(full, acc);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) acc.push(full);
  }
  return acc;
}

const sources = listSources(join(ROOT, "src"))
  .map((f) => ({ rel: relative(ROOT, f).split(sep).join("/"), text: readFileSync(f, "utf-8") }))
  .filter((s) => !isTestFile(s.rel));

describe("static inventory of host-execution sites in src/", () => {
  const execFiles = sources.filter((s) => EXEC_IMPORT_PATTERNS.some((p) => p.test(s.text)));

  it("every src/ file that can start a host process is reviewed", () => {
    const reviewed = new Set([...Object.keys(GUARDED_FILES), ...Object.keys(REACHABLE_ONLY_VIA_GUARD)]);
    const unreviewed = execFiles.map((s) => s.rel).filter((rel) => !reviewed.has(rel));
    expect(unreviewed, `Unreviewed host-execution files: ${unreviewed.join(", ")}`).toEqual([]);
  });

  it("every reviewed entry still exists and still starts a process (no stale entries)", () => {
    const found = new Set(execFiles.map((s) => s.rel));
    // agents/execute starts processes indirectly via lib/command-executor.
    const indirect = new Set(["src/app/api/agents/execute/route.ts"]);
    for (const rel of [...Object.keys(GUARDED_FILES), ...Object.keys(REACHABLE_ONLY_VIA_GUARD)]) {
      if (indirect.has(rel)) continue;
      expect(found.has(rel), `${rel} is listed but no longer imports a process API`).toBe(true);
    }
  });

  it("guarded files import the shared guard and carry their marker", () => {
    for (const [rel, markers] of Object.entries(GUARDED_FILES)) {
      const text = sources.find((s) => s.rel === rel)?.text ?? "";
      expect(text, `${rel} must import the guard`).toMatch(/@\/lib\/host-execution-guard/);
      for (const marker of markers) {
        expect(text, `${rel} is missing guard ${marker}`).toMatch(marker);
      }
    }
  });

  it("guard calls come before any process is started in the three admin routes", () => {
    const routes: Array<[string, RegExp, RegExp]> = [
      ["src/app/api/bridge/cli/route.ts", /hostExecutionBlockedResponse\("bridge-cli"\)/, /\bspawn\(/],
      ["src/app/api/agents/execute/route.ts", /hostExecutionBlockedResponse\("agents-execute"\)/, /\bexecuteCommand\(/],
      ["src/app/api/litt/command/route.ts", /hostExecutionBlockedResponse\("litt-command"\)/, /\bexecFileAsync\(command\./],
    ];
    for (const [rel, guard, start] of routes) {
      const text = sources.find((s) => s.rel === rel)!.text;
      const g = text.search(guard);
      const s = text.search(start);
      expect(g, `${rel}: guard not found`).toBeGreaterThan(-1);
      expect(s, `${rel}: process start not found`).toBeGreaterThan(-1);
      expect(g, `${rel}: guard must precede the process start`).toBeLessThan(s);
    }
  });

  it("reachable-only-via-guard modules are imported only by their guarded entry point", () => {
    for (const [rel, rule] of Object.entries(REACHABLE_ONLY_VIA_GUARD)) {
      const guardText = sources.find((s) => s.rel === rule.viaGuard)?.text ?? "";
      expect(guardText, `${rule.viaGuard} must hold the guard for ${rel}`).toMatch(rule.guardMarker);
      const importers = sources
        .filter((s) => s.rel !== rel && rule.importPattern.test(s.text))
        .map((s) => s.rel)
        .sort();
      expect(importers, `${rel} has unexpected importers`).toEqual([...rule.importers].sort());
    }
  });

  it("the sandbox provider factory cannot select Docker in a production-like environment", () => {
    const text = sources.find((s) => s.rel === "src/lib/terminal-v1/providers/index.ts")!.text;
    const guard = text.search(/isProductionLike\(\)/);
    const select = text.search(/new DockerSandboxProvider\(\)/);
    expect(guard).toBeGreaterThan(-1);
    expect(select).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(select);
  });
});

// ─── 3. Container hardening / image regressions ──────────────────────

describe("container hardening", () => {
  const read = (rel: string) => readFileSync(join(ROOT, rel), "utf-8");

  it("terminal-v1 docker provider drops all capabilities and blocks privilege gain", () => {
    const text = read("src/lib/terminal-v1/providers/docker-provider.ts");
    expect(text).toMatch(/"--cap-drop",\s*"ALL"/);
    expect(text).toMatch(/"--security-opt",\s*"no-new-privileges"/);
  });

  it("terminal-server docker session blocks privilege gain", () => {
    const text = read("terminal-server/docker-manager.ts");
    expect(text).toMatch(/"--security-opt",\s*"no-new-privileges"/);
  });

  it("neither docker path mounts the docker socket or runs privileged", () => {
    for (const rel of ["terminal-server/docker-manager.ts", "src/lib/terminal-v1/providers/docker-provider.ts"]) {
      const text = read(rel);
      expect(text, rel).not.toMatch(/docker\.sock/);
      expect(text, rel).not.toMatch(/"--privileged"/);
    }
  });

  it("sandbox.Dockerfile uses a real base image tag", () => {
    const path = join(ROOT, "terminal-server/sandbox.Dockerfile");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf-8");
    expect(text).toMatch(/^FROM node:22-bookworm-slim\s*$/m);
    expect(text).not.toMatch(/book-slim/);
  });
});
