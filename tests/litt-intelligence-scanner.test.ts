import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { scanProject, partialScan } from "@/lib/litt-intelligence/project-scanner";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

const TEST_REPO = join(tmpdir(), `litt-scan-test-${Date.now()}`);

function setupTestRepo() {
  mkdirSync(TEST_REPO, { recursive: true });
  mkdirSync(join(TEST_REPO, "src", "app", "api", "media", "generate"), { recursive: true });
  mkdirSync(join(TEST_REPO, "src", "lib", "litt-kernel"), { recursive: true });
  mkdirSync(join(TEST_REPO, "src", "lib", "terminal-v1"), { recursive: true });
  mkdirSync(join(TEST_REPO, "src", "lib", "studio"), { recursive: true });
  mkdirSync(join(TEST_REPO, "supabase", "migrations"), { recursive: true });
  mkdirSync(join(TEST_REPO, "tests"), { recursive: true });

  // package.json
  writeFileSync(
    join(TEST_REPO, "package.json"),
    JSON.stringify({
      name: "test-project",
      dependencies: {
        next: "^16.0.0",
        react: "^19.0.0",
        "@supabase/supabase-js": "^2.0.0",
        "@clerk/nextjs": "^6.0.0",
        stripe: "^17.0.0",
        "tailwindcss": "^4.0.0",
      },
      devDependencies: {
        vitest: "^2.0.0",
        "@types/node": "^22.0.0",
      },
    }),
  );

  // pnpm-lock.yaml
  writeFileSync(join(TEST_REPO, "pnpm-lock.yaml"), "lockfileVersion: 6.0\n");

  // vercel.json
  writeFileSync(join(TEST_REPO, "vercel.json"), "{}");

  // .env.example (names only, no values)
  writeFileSync(
    join(TEST_REPO, ".env.example"),
    "NEXT_PUBLIC_SUPABASE_URL=\nSUPABASE_SERVICE_ROLE_KEY=\nCLERK_SECRET_KEY=\nSTRIPE_SECRET_KEY=\nOPENROUTER_API_KEY=\n",
  );

  // .gitignore
  writeFileSync(join(TEST_REPO, ".gitignore"), "node_modules/\n.env\n");

  // Entry points
  writeFileSync(join(TEST_REPO, "src", "app", "layout.tsx"), "export default function Layout() { return null; }");
  writeFileSync(join(TEST_REPO, "src", "app", "page.tsx"), "export default function Page() { return null; }");

  // API route
  writeFileSync(
    join(TEST_REPO, "src", "app", "api", "media", "generate", "route.ts"),
    "export async function POST() { return Response.json({}); }",
  );

  // Service file
  writeFileSync(
    join(TEST_REPO, "src", "lib", "studio", "memory-service.ts"),
    "export async function recallMemories() { return []; }",
  );

  // Supabase client
  writeFileSync(
    join(TEST_REPO, "src", "lib", "supabase.ts"),
    "export const supabaseAdmin = {};",
  );

  // LiTT Kernel
  writeFileSync(
    join(TEST_REPO, "src", "lib", "litt-kernel", "kernel.ts"),
    "export function routeKernel() { return { ok: true }; }",
  );

  // Terminal V1
  writeFileSync(
    join(TEST_REPO, "src", "lib", "terminal-v1", "control-plane.ts"),
    "export const TERMINAL_AUDIENCE = 'littree-terminal-v1';",
  );

  // Supabase migration
  writeFileSync(
    join(TEST_REPO, "supabase", "migrations", "20260101000000_initial.sql"),
    "CREATE TABLE test (id TEXT PRIMARY KEY);",
  );

  // Test files
  writeFileSync(join(TEST_REPO, "tests", "example.test.ts"), "describe('test', () => { it('works', () => {}); });");
  writeFileSync(
    join(TEST_REPO, "vitest.config.ts"),
    "export default { test: { environment: 'node' } };",
  );

  // Init git repo
  try {
    execSync("git init", { cwd: TEST_REPO });
    execSync("git add -A", { cwd: TEST_REPO });
    execSync('git commit -m "init" --no-gpg-sign', { cwd: TEST_REPO });
  } catch {
    // git may not be available in all environments
  }
}

function cleanupTestRepo() {
  if (existsSync(TEST_REPO)) {
    rmSync(TEST_REPO, { recursive: true, force: true });
  }
}

describe("LiTT Intelligence — Project Scanner", () => {
  beforeEach(() => {
    setupTestRepo();
  });

  afterEach(() => {
    cleanupTestRepo();
  });

  // ─── Stack detection ────────────────────────────────────────────

  it("detects TypeScript and Node.js runtime", () => {
    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    expect(snapshot.stack.languages).toContain("TypeScript");
    expect(snapshot.stack.runtimes).toContain("Node.js");
  });

  it("detects Next.js framework", () => {
    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    expect(snapshot.stack.frameworks).toContain("Next.js");
  });

  it("detects React framework", () => {
    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    expect(snapshot.stack.frameworks).toContain("React");
  });

  it("detects Tailwind CSS framework", () => {
    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    expect(snapshot.stack.frameworks).toContain("Tailwind CSS");
  });

  it("detects pnpm package manager", () => {
    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    expect(snapshot.stack.packageManagers).toContain("pnpm");
  });

  it("detects Supabase database", () => {
    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    expect(snapshot.stack.databases).toContain("Supabase (PostgreSQL)");
  });

  it("detects Vercel deployment target", () => {
    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    expect(snapshot.stack.deploymentTargets).toContain("Vercel");
  });

  it("detects Clerk Auth framework", () => {
    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    expect(snapshot.stack.frameworks).toContain("Clerk Auth");
  });

  it("detects Stripe framework", () => {
    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    expect(snapshot.stack.frameworks).toContain("Stripe");
  });

  // ─── Architecture detection ────────────────────────────────────

  it("detects entry points", () => {
    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    expect(snapshot.architecture.entryPoints.length).toBeGreaterThan(0);
    const layoutEntry = snapshot.architecture.entryPoints.find((e) => e.path === "src/app/layout.tsx");
    expect(layoutEntry).toBeDefined();
    expect(layoutEntry!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("detects API routes", () => {
    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    expect(snapshot.architecture.APIs.length).toBeGreaterThan(0);
    const mediaApi = snapshot.architecture.APIs.find((a) => a.path.includes("media/generate"));
    expect(mediaApi).toBeDefined();
  });

  it("detects services", () => {
    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    expect(snapshot.architecture.services.length).toBeGreaterThan(0);
    const memoryService = snapshot.architecture.services.find((s) => s.name.includes("memory-service"));
    expect(memoryService).toBeDefined();
  });

  it("detects data stores (migrations)", () => {
    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    expect(snapshot.architecture.dataStores.length).toBeGreaterThan(0);
    const supabaseStore = snapshot.architecture.dataStores.find((d) => d.path.includes("supabase"));
    expect(supabaseStore).toBeDefined();
  });

  it("detects integrations from env example", () => {
    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    expect(snapshot.architecture.integrations.length).toBeGreaterThan(0);
    const supabaseIntegration = snapshot.architecture.integrations.find((i) => i.name.includes("SUPABASE"));
    expect(supabaseIntegration).toBeDefined();
  });

  it("detects tool modules", () => {
    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    expect(snapshot.architecture.tools.length).toBeGreaterThan(0);
    const kernelTool = snapshot.architecture.tools.find((t) => t.path.includes("litt-kernel"));
    expect(kernelTool).toBeDefined();
  });

  it("records source paths for every architecture component", () => {
    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    for (const api of snapshot.architecture.APIs) {
      expect(api.sourcePaths.length).toBeGreaterThan(0);
    }
    for (const service of snapshot.architecture.services) {
      expect(service.sourcePaths.length).toBeGreaterThan(0);
    }
  });

  // ─── Capability detection ──────────────────────────────────────

  it("detects capabilities from file existence", () => {
    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    const caps = snapshot.capabilities;
    expect(caps.length).toBeGreaterThan(0);

    const githubCap = caps.find((c) => c.id === "github");
    expect(githubCap).toBeDefined();

    const supabaseCap = caps.find((c) => c.id === "supabase");
    expect(supabaseCap).toBeDefined();
    expect(supabaseCap!.state).toBe("ready");
    expect(supabaseCap!.confidence).toBeGreaterThan(0.5);
  });

  it("does not claim missing capabilities are ready", () => {
    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    const terminalCap = snapshot.capabilities.find((c) => c.id === "terminal");
    expect(terminalCap).toBeDefined();
    // terminal-v1 dir exists in test repo
    expect(terminalCap!.state).toBe("ready");
  });

  it("marks non-existent capabilities as unknown", () => {
    // Create a repo without terminal-v1
    const minimalRepo = join(tmpdir(), `litt-scan-minimal-${Date.now()}`);
    mkdirSync(join(minimalRepo, "src", "app"), { recursive: true });
    writeFileSync(join(minimalRepo, "package.json"), '{"name":"minimal"}');
    writeFileSync(join(minimalRepo, ".gitignore"), "node_modules/\n");
    writeFileSync(join(minimalRepo, "src", "app", "page.tsx"), "export default () => null;");

    const snapshot = scanProject({ projectId: "test-min", repoRoot: minimalRepo });
    const terminalCap = snapshot.capabilities.find((c) => c.id === "terminal");
    expect(terminalCap).toBeDefined();
    expect(terminalCap!.state).toBe("unknown");
    expect(terminalCap!.confidence).toBeLessThan(0.5);

    rmSync(minimalRepo, { recursive: true, force: true });
  });

  // ─── Dependencies ──────────────────────────────────────────────

  it("parses production dependencies", () => {
    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    const nextDep = snapshot.dependencies.find((d) => d.name === "next");
    expect(nextDep).toBeDefined();
    expect(nextDep!.type).toBe("production");
    expect(nextDep!.version).toMatch(/\^16/);
  });

  it("parses dev dependencies", () => {
    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    const vitestDep = snapshot.dependencies.find((d) => d.name === "vitest");
    expect(vitestDep).toBeDefined();
    expect(vitestDep!.type).toBe("development");
  });

  // ─── Tests ─────────────────────────────────────────────────────

  it("detects Vitest framework", () => {
    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    expect(snapshot.tests.framework).toBe("Vitest");
    expect(snapshot.tests.configPath).toBe("vitest.config.ts");
  });

  it("counts test files correctly", () => {
    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    expect(snapshot.tests.testCount).toBeGreaterThan(0);
    expect(snapshot.tests.testFiles.some((f) => f.includes("example.test.ts"))).toBe(true);
  });

  // ─── Risks ─────────────────────────────────────────────────────

  it("does not flag .gitignore as missing when it exists", () => {
    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    const noGitignoreRisk = snapshot.risks.find((r) => r.id === "risk:no_gitignore");
    expect(noGitignoreRisk).toBeUndefined();
  });

  it("flags missing .gitignore", () => {
    const noGitignoreRepo = join(tmpdir(), `litt-scan-nogit-${Date.now()}`);
    mkdirSync(join(noGitignoreRepo, "src"), { recursive: true });
    writeFileSync(join(noGitignoreRepo, "package.json"), "{}");
    writeFileSync(join(noGitignoreRepo, "src", "page.tsx"), "export default () => null;");

    const snapshot = scanProject({ projectId: "test-nogit", repoRoot: noGitignoreRepo });
    const risk = snapshot.risks.find((r) => r.id === "risk:no_gitignore");
    expect(risk).toBeDefined();
    expect(risk!.severity).toBe("high");

    rmSync(noGitignoreRepo, { recursive: true, force: true });
  });

  // ─── Snapshot metadata ─────────────────────────────────────────

  it("records scannedAt timestamp", () => {
    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    expect(snapshot.scannedAt).toBeTruthy();
    expect(new Date(snapshot.scannedAt).getTime()).not.toBeNaN();
  });

  it("records sourceRevision (git SHA)", () => {
    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    expect(snapshot.sourceRevision).toBeTruthy();
  });

  it("is not stale on first scan", () => {
    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    expect(snapshot.stale).toBe(false);
  });

  it("marks snapshot as stale when HEAD changes", () => {
    const first = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    // Simulate a different SHA by providing a previous snapshot with a different revision
    const second = scanProject({
      projectId: "test-1",
      repoRoot: TEST_REPO,
      previousSnapshot: { ...first, sourceRevision: "different-sha" },
    });
    expect(second.stale).toBe(true);
  });

  // ─── Repository info ───────────────────────────────────────────

  it("includes repository info when provided", () => {
    const snapshot = scanProject({
      projectId: "test-1",
      repoRoot: TEST_REPO,
      repository: {
        provider: "github",
        owner: "litlabs",
        name: "studio",
        defaultBranch: "main",
      },
    });
    expect(snapshot.repository).toBeDefined();
    expect(snapshot.repository!.owner).toBe("litlabs");
    expect(snapshot.repository!.name).toBe("studio");
    expect(snapshot.repository!.defaultBranch).toBe("main");
  });

  it("omits repository info when not provided", () => {
    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    expect(snapshot.repository).toBeUndefined();
  });

  // ─── Partial scan ──────────────────────────────────────────────

  it("partial scan re-scans dependencies when package.json changes", () => {
    const first = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });

    // Add a new dependency
    const pkg = JSON.parse(readFileSync(join(TEST_REPO, "package.json"), "utf-8"));
    pkg.dependencies["zod"] = "^3.0.0";
    writeFileSync(join(TEST_REPO, "package.json"), JSON.stringify(pkg));

    const partial = partialScan({
      projectId: "test-1",
      repoRoot: TEST_REPO,
      changedFiles: ["package.json"],
      previousSnapshot: first,
    });

    expect(partial.dependencies).toBeDefined();
    expect(partial.dependencies!.find((d) => d.name === "zod")).toBeDefined();
  });

  it("partial scan falls back to full scan without previous snapshot", () => {
    const result = partialScan({
      projectId: "test-1",
      repoRoot: TEST_REPO,
      changedFiles: ["package.json"],
    });
    // Should return a full snapshot
    expect(result.stack).toBeDefined();
    expect(result.architecture).toBeDefined();
  });

  // ─── Never store secrets ───────────────────────────────────────

  it("never includes secret values in the snapshot", () => {
    // Write an .env file with a fake secret (but .gitignored)
    writeFileSync(join(TEST_REPO, ".env.local"), "SUPABASE_SERVICE_ROLE_KEY=sk_test_fake_secret_12345");

    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });

    // The snapshot should not contain the secret value anywhere
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("sk_test_fake_secret_12345");
  });

  // ─── Skip generated dirs ───────────────────────────────────────

  it("does not scan node_modules", () => {
    mkdirSync(join(TEST_REPO, "node_modules", "fake-pkg"), { recursive: true });
    writeFileSync(join(TEST_REPO, "node_modules", "fake-pkg", "index.test.ts"), "it('fake', () => {});");

    const snapshot = scanProject({ projectId: "test-1", repoRoot: TEST_REPO });
    expect(snapshot.tests.testFiles.some((f) => f.includes("node_modules"))).toBe(false);

    rmSync(join(TEST_REPO, "node_modules"), { recursive: true, force: true });
  });
});
