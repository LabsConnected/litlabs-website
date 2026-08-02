/**
 * Project Intelligence Scanner
 *
 * Creates a structured ProjectIntelligenceSnapshot by scanning the
 * repository content. Uses deterministic tools (file system reads,
 * manifest parsing, glob patterns) — NOT an LLM — to build a compact
 * inventory.
 *
 * Scanner rules:
 * - Repository content is the source of truth.
 * - Record source paths for every conclusion.
 * - Record confidence.
 * - Record scan timestamp and repository SHA.
 * - Never retrieve or store secret values.
 * - Do not scan generated folders, dependencies, or build output.
 * - Do not treat a component's existence as proof of production-readiness.
 *
 * The scanner is designed to be called server-side from an API route
 * or the LiTT Kernel. It does NOT call the LLM — it produces a
 * deterministic inventory that the Kernel can then reason over.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, relative, extname, basename } from "path";
import { execSync } from "child_process";
import type {
  ProjectIntelligenceSnapshot,
  VerifiedCapability,
  DependencyRecord,
  TestInventory,
  ProjectRisk,
  OpenWorkItem,
} from "./types";

// ─── Constants ──────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  ".cache",
  ".turbo",
  "coverage",
  ".worktrees",
  "out",
  ".vercel",
  "__pycache__",
  ".pytest_cache",
  "venv",
  ".venv",
  "vendor",
  "target",
  "*.egg-info",
]);

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".rb",
  ".php",
  ".vue",
  ".svelte",
  ".astro",
]);

// ─── Scanner input ──────────────────────────────────────────────

export interface ScanInput {
  projectId: string;
  repoRoot: string;
  repository?: {
    provider: "github";
    owner: string;
    name: string;
    defaultBranch: string;
  };
  tier?: 0 | 1 | 2 | 3 | 4;
  changedFiles?: string[];
  previousSnapshot?: ProjectIntelligenceSnapshot;
}

// ─── Helpers ────────────────────────────────────────────────────

function safeReadFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function safeExec(cmd: string, cwd: string): string | null {
  try {
    return execSync(cmd, { cwd, encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

function getGitHeadSha(repoRoot: string): string {
  return safeExec("git rev-parse HEAD", repoRoot) ?? "unknown";
}

function listFiles(dir: string, maxDepth = 5, depth = 0): string[] {
  if (depth > maxDepth) return [];
  const results: string[] = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          results.push(...listFiles(fullPath, maxDepth, depth + 1));
        } else {
          results.push(fullPath);
        }
      } catch {
        // skip
      }
    }
  } catch {
    // skip
  }
  return results;
}

function relativePath(repoRoot: string, absPath: string): string {
  return relative(repoRoot, absPath).replace(/\\/g, "/");
}

// ─── Stack detection ────────────────────────────────────────────

interface StackDetection {
  languages: string[];
  frameworks: string[];
  runtimes: string[];
  packageManagers: string[];
  databases: string[];
  deploymentTargets: string[];
}

function detectStack(repoRoot: string): StackDetection {
  const detection: StackDetection = {
    languages: [],
    frameworks: [],
    runtimes: [],
    packageManagers: [],
    databases: [],
    deploymentTargets: [],
  };

  // Package manifests
  const hasPkg = existsSync(join(repoRoot, "package.json"));
  const hasPyproject = existsSync(join(repoRoot, "pyproject.toml"));
  const hasRequirements = existsSync(join(repoRoot, "requirements.txt"));
  const hasGoMod = existsSync(join(repoRoot, "go.mod"));
  const hasCargo = existsSync(join(repoRoot, "Cargo.toml"));

  // Languages
  if (hasPkg) {
    detection.languages.push("TypeScript", "JavaScript");
    detection.runtimes.push("Node.js");
  }
  if (hasPyproject || hasRequirements) {
    detection.languages.push("Python");
    detection.runtimes.push("Python");
  }
  if (hasGoMod) {
    detection.languages.push("Go");
    detection.runtimes.push("Go");
  }
  if (hasCargo) {
    detection.languages.push("Rust");
    detection.runtimes.push("Rust");
  }

  // Package managers
  if (existsSync(join(repoRoot, "pnpm-lock.yaml"))) detection.packageManagers.push("pnpm");
  if (existsSync(join(repoRoot, "package-lock.json"))) detection.packageManagers.push("npm");
  if (existsSync(join(repoRoot, "yarn.lock"))) detection.packageManagers.push("yarn");
  if (existsSync(join(repoRoot, "uv.lock"))) detection.packageManagers.push("uv");
  if (existsSync(join(repoRoot, "poetry.lock"))) detection.packageManagers.push("poetry");

  // Frameworks from package.json
  if (hasPkg) {
    const pkg = safeReadFile(join(repoRoot, "package.json"));
    if (pkg) {
      try {
        const parsed = JSON.parse(pkg);
      const deps = { ...parsed.dependencies, ...parsed.devDependencies };
      if (deps["next"]) detection.frameworks.push("Next.js");
      if (deps["react"]) detection.frameworks.push("React");
      if (deps["vue"]) detection.frameworks.push("Vue");
      if (deps["@sveltejs/kit"]) detection.frameworks.push("SvelteKit");
      if (deps["astro"]) detection.frameworks.push("Astro");
      if (deps["express"]) detection.frameworks.push("Express");
      if (deps["fastify"]) detection.frameworks.push("Fastify");
      if (deps["tailwindcss"]) detection.frameworks.push("Tailwind CSS");
      if (deps["@supabase/supabase-js"]) detection.databases.push("Supabase (PostgreSQL)");
      if (deps["drizzle-orm"]) detection.databases.push("Drizzle ORM");
      if (deps["prisma"]) detection.databases.push("Prisma");
      if (deps["@clerk/nextjs"]) detection.frameworks.push("Clerk Auth");
      if (deps["stripe"]) detection.frameworks.push("Stripe");
      } catch {
        // ignore parse errors
      }
    }
  }

  // Deployment targets
  if (existsSync(join(repoRoot, "vercel.json")) || existsSync(join(repoRoot, ".vercel"))) {
    detection.deploymentTargets.push("Vercel");
  }
  if (existsSync(join(repoRoot, "netlify.toml"))) detection.deploymentTargets.push("Netlify");
  if (existsSync(join(repoRoot, "Dockerfile")) || existsSync(join(repoRoot, "docker-compose.yml"))) {
    detection.deploymentTargets.push("Docker");
  }
  if (existsSync(join(repoRoot, "nixpacks.toml"))) detection.deploymentTargets.push("Nixpacks");
  if (existsSync(join(repoRoot, "fly.toml"))) detection.deploymentTargets.push("Fly.io");

  // Deduplicate
  detection.languages = [...new Set(detection.languages)];
  detection.frameworks = [...new Set(detection.frameworks)];
  detection.runtimes = [...new Set(detection.runtimes)];
  detection.packageManagers = [...new Set(detection.packageManagers)];
  detection.databases = [...new Set(detection.databases)];
  detection.deploymentTargets = [...new Set(detection.deploymentTargets)];

  return detection;
}

// ─── Architecture detection ─────────────────────────────────────

function detectArchitecture(repoRoot: string): ProjectIntelligenceSnapshot["architecture"] {
  const arch: ProjectIntelligenceSnapshot["architecture"] = {
    entryPoints: [],
    services: [],
    APIs: [],
    dataStores: [],
    integrations: [],
    tools: [],
  };

  const srcDir = join(repoRoot, "src");
  const appDir = existsSync(srcDir) ? join(srcDir, "app") : join(repoRoot, "app");
  const apiDir = existsSync(appDir) ? join(appDir, "api") : null;

  // Entry points
  const entryCandidates = [
    "src/app/layout.tsx",
    "src/app/page.tsx",
    "src/index.ts",
    "src/main.ts",
    "src/index.tsx",
    "src/main.tsx",
    "index.js",
    "server.ts",
    "worker/entry.ts",
  ];
  for (const candidate of entryCandidates) {
    const fullPath = join(repoRoot, candidate);
    if (existsSync(fullPath)) {
      arch.entryPoints.push({
        id: `entry:${candidate}`,
        type: "entry_point",
        path: candidate,
        name: basename(candidate),
        confidence: 0.95,
        sourcePaths: [candidate],
      });
    }
  }

  // API routes (Next.js App Router)
  if (apiDir && existsSync(apiDir)) {
    const routeFiles = findRouteFiles(apiDir, apiDir);
    for (const routeFile of routeFiles) {
      const relPath = relativePath(repoRoot, routeFile);
      const routePath = relPath
        .replace(/\\/g, "/")
        .replace(/^src\/app\/api\//, "/api/")
        .replace(/\/route\.(ts|tsx|js|jsx)$/, "")
        .replace(/\[\.\.\.(\w+)\]/g, ":$1+")
        .replace(/\[(\w+)\]/g, ":$1");
      arch.APIs.push({
        id: `api:${routePath}`,
        type: "api_route",
        path: routePath,
        name: routePath,
        confidence: 0.9,
        sourcePaths: [relPath],
      });
    }
  }

  // Services (src/lib/**/*service*.ts, src/services/**)
  const servicePatterns = [
    "src/lib/**/*.ts",
    "src/services/**/*.ts",
    "src/server/**/*.ts",
  ];
  for (const pattern of servicePatterns) {
    const dir = pattern.replace(/\/\*\*\/.*$/, "");
    const fullDir = join(repoRoot, dir);
    if (existsSync(fullDir)) {
      const files = listFiles(fullDir, 4).filter(
        (f) => f.endsWith(".ts") && /service|provider|broker|gateway|manager|scanner/i.test(f),
      );
      for (const file of files) {
        const relPath = relativePath(repoRoot, file);
        arch.services.push({
          id: `service:${relPath}`,
          type: "service",
          path: relPath,
          name: basename(file, ".ts"),
          confidence: 0.7,
          sourcePaths: [relPath],
        });
      }
    }
  }

  // Data stores (migrations, schema files)
  const migrationDirs = ["supabase/migrations", "db/migrations", "prisma", "drizzle"];
  for (const migDir of migrationDirs) {
    const fullDir = join(repoRoot, migDir);
    if (existsSync(fullDir)) {
      arch.dataStores.push({
        id: `datastore:${migDir}`,
        type: "data_store",
        path: migDir,
        name: migDir,
        confidence: 0.85,
        sourcePaths: [migDir],
      });
    }
  }

  // Integrations (env vars, config files)
  const envExample = safeReadFile(join(repoRoot, ".env.example"));
  if (envExample) {
    const integrationKeys = extractIntegrationEnvKeys(envExample);
    for (const key of integrationKeys) {
      arch.integrations.push({
        id: `integration:${key}`,
        type: "integration",
        path: ".env.example",
        name: key,
        description: "Environment variable reference (name only, not value)",
        confidence: 0.5,
        sourcePaths: [".env.example"],
      });
    }
  }

  // Tools (src/lib/terminal-v1, src/lib/litt-kernel, etc.)
  const toolDirs = ["src/lib/terminal-v1", "src/lib/litt-kernel", "src/lib/litt-intelligence"];
  for (const toolDir of toolDirs) {
    const fullDir = join(repoRoot, toolDir);
    if (existsSync(fullDir)) {
      arch.tools.push({
        id: `tool:${toolDir}`,
        type: "tool_module",
        path: toolDir,
        name: basename(toolDir),
        confidence: 0.8,
        sourcePaths: [toolDir],
      });
    }
  }

  return arch;
}

function findRouteFiles(dir: string, baseDir: string): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        results.push(...findRouteFiles(fullPath, baseDir));
      } else if (/^route\.(ts|tsx|js|jsx)$/.test(entry)) {
        results.push(fullPath);
      }
    }
  } catch {
    // skip
  }
  return results;
}

function extractIntegrationEnvKeys(envContent: string): string[] {
  const keys = new Set<string>();
  const lines = envContent.split("\n");
  const integrationPatterns = [
    /CLERK/i,
    /SUPABASE/i,
    /STRIPE/i,
    /OPENROUTER/i,
    /GEMINI/i,
    /TOGETHER/i,
    /FAL/i,
    /MINIMAX/i,
    /INWORLD/i,
    /CLOUDFLARE/i,
    /R2/i,
    /VOICE/i,
    /GITHUB/i,
    /SUPERMEMORY/i,
  ];
  for (const line of lines) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (match) {
      const key = match[1];
      if (integrationPatterns.some((p) => p.test(key))) {
        keys.add(key);
      }
    }
  }
  return [...keys];
}

// ─── Dependency analysis ────────────────────────────────────────

function analyzeDependencies(repoRoot: string): DependencyRecord[] {
  const deps: DependencyRecord[] = [];
  const pkgContent = safeReadFile(join(repoRoot, "package.json"));
  if (!pkgContent) return deps;

  try {
    const pkg = JSON.parse(pkgContent);
    const sections: Array<{ type: DependencyRecord["type"]; section: Record<string, string> | undefined }> = [
      { type: "production", section: pkg.dependencies },
      { type: "development", section: pkg.devDependencies },
      { type: "peer", section: pkg.peerDependencies },
      { type: "optional", section: pkg.optionalDependencies },
    ];

    for (const { type, section } of sections) {
      if (!section) continue;
      for (const [name, version] of Object.entries(section)) {
        deps.push({
          name,
          version,
          type,
          source: "package.json",
        });
      }
    }
  } catch {
    // ignore
  }

  return deps;
}

// ─── Test inventory ─────────────────────────────────────────────

function analyzeTests(repoRoot: string): TestInventory {
  const testFiles: string[] = [];

  // Find test files
  const allFiles = listFiles(repoRoot, 6);
  for (const file of allFiles) {
    const base = basename(file);
    if (
      base.endsWith(".test.ts") ||
      base.endsWith(".test.tsx") ||
      base.endsWith(".test.js") ||
      base.endsWith(".test.jsx") ||
      base.endsWith(".spec.ts") ||
      base.endsWith(".spec.tsx") ||
      base.endsWith(".spec.js") ||
      base.endsWith(".spec.jsx")
    ) {
      testFiles.push(relativePath(repoRoot, file));
    }
  }

  // Detect framework
  let framework: string | null = null;
  let configPath: string | null = null;

  if (existsSync(join(repoRoot, "vitest.config.ts"))) {
    framework = "Vitest";
    configPath = "vitest.config.ts";
  } else if (existsSync(join(repoRoot, "jest.config.ts")) || existsSync(join(repoRoot, "jest.config.js"))) {
    framework = "Jest";
    configPath = existsSync(join(repoRoot, "jest.config.ts")) ? "jest.config.ts" : "jest.config.js";
  } else if (existsSync(join(repoRoot, "playwright.config.ts"))) {
    framework = "Playwright";
    configPath = "playwright.config.ts";
  }

  return {
    framework,
    testFiles,
    testCount: testFiles.length,
    configPath,
    coverage: existsSync(join(repoRoot, "coverage")),
  };
}

// ─── Risk detection ─────────────────────────────────────────────

function detectRisks(repoRoot: string): ProjectRisk[] {
  const risks: ProjectRisk[] = [];
  const now = new Date().toISOString();

  // Check for .env files committed (not .env.example)
  const envFiles = [".env", ".env.local", ".env.production"];
  for (const envFile of envFiles) {
    const fullPath = join(repoRoot, envFile);
    if (existsSync(fullPath)) {
      const gitCheck = safeExec(`git ls-files --error-unmatch ${envFile}`, repoRoot);
      if (gitCheck !== null) {
        risks.push({
          id: `risk:env_committed:${envFile}`,
          severity: "critical",
          description: `${envFile} appears to be tracked in git — may contain secrets`,
          sourcePath: envFile,
          detectedAt: now,
        });
      }
    }
  }

  // Check for missing .gitignore
  if (!existsSync(join(repoRoot, ".gitignore"))) {
    risks.push({
      id: "risk:no_gitignore",
      severity: "high",
      description: "No .gitignore file found",
      sourcePath: ".",
      detectedAt: now,
    });
  }

  // Check for outdated or deprecated patterns
  const pkgContent = safeReadFile(join(repoRoot, "package.json"));
  if (pkgContent) {
    try {
      const pkg = JSON.parse(pkgContent);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [name] of Object.entries(allDeps)) {
        if (name.includes("deprecated") || name.includes("legacy")) {
          risks.push({
            id: `risk:deprecated_dep:${name}`,
            severity: "low",
            description: `Potentially deprecated dependency: ${name}`,
            sourcePath: "package.json",
            detectedAt: now,
          });
        }
      }
    } catch {
      // ignore
    }
  }

  return risks;
}

// ─── Open work detection ────────────────────────────────────────

function detectOpenWork(repoRoot: string): OpenWorkItem[] {
  const items: OpenWorkItem[] = [];

  // Recent branches
  const branches = safeExec("git branch --list --sort=-committerdate -20", repoRoot);
  if (branches) {
    for (const line of branches.split("\n").slice(0, 10)) {
      const branchName = line.trim().replace(/^\* /, "");
      if (branchName && !branchName.includes("main") && !branchName.includes("HEAD")) {
        items.push({
          id: `branch:${branchName}`,
          type: "branch",
          title: branchName,
          state: "open",
        });
      }
    }
  }

  // TODO comments in source files (sampled)
  const allFiles = listFiles(join(repoRoot, "src"), 4).filter((f) => SOURCE_EXTENSIONS.has(extname(f)));
  let todoCount = 0;
  for (const file of allFiles.slice(0, 100)) {
    const content = safeReadFile(file);
    if (content && /\bTODO\b|\bFIXME\b|\bHACK\b/.test(content)) {
      todoCount++;
    }
  }
  if (todoCount > 0) {
    items.push({
      id: "todos:source",
      type: "todo",
      title: `${todoCount} files with TODO/FIXME markers in src/`,
      state: "open",
    });
  }

  return items;
}

// ─── Capability detection (from file existence, NOT env values) ─

function detectCapabilities(repoRoot: string): VerifiedCapability[] {
  const caps: VerifiedCapability[] = [];
  const now = new Date().toISOString();

  const checks: Array<{ id: string; category: string; path: string; evidence: string }> = [
    { id: "github", category: "integration", path: "src/lib/github", evidence: "GitHub integration module exists" },
    { id: "supabase", category: "database", path: "src/lib/supabase.ts", evidence: "Supabase client module exists" },
    { id: "clerk", category: "auth", path: "src/lib/auth.ts", evidence: "Auth module exists" },
    { id: "stripe", category: "payments", path: "src/lib/stripe", evidence: "Stripe integration exists" },
    { id: "voice", category: "media", path: "src/app/api/voice", evidence: "Voice API routes exist" },
    { id: "image_generation", category: "media", path: "src/app/api/media/generate", evidence: "Image generation API exists" },
    { id: "terminal", category: "infrastructure", path: "src/lib/terminal-v1", evidence: "Terminal V1 module exists" },
    { id: "litt_kernel", category: "ai", path: "src/lib/litt-kernel", evidence: "LiTT Kernel module exists" },
    { id: "memory", category: "ai", path: "src/lib/studio/memory-service.ts", evidence: "Memory service exists" },
  ];

  for (const check of checks) {
    const fullPath = join(repoRoot, check.path);
    const exists = existsSync(fullPath);
    caps.push({
      id: check.id,
      category: check.category,
      state: exists ? "ready" : "unknown",
      verifiedAt: now,
      source: `file_exists:${check.path}`,
      evidence: exists ? check.evidence : `Not found at ${check.path}`,
      confidence: exists ? 0.7 : 0.3,
    });
  }

  return caps;
}

// ─── Main scanner ───────────────────────────────────────────────

export function scanProject(input: ScanInput): ProjectIntelligenceSnapshot {
  const { projectId, repoRoot, repository, previousSnapshot } = input;
  const headSha = getGitHeadSha(repoRoot);
  const scannedAt = new Date().toISOString();

  // Detect staleness
  const stale = previousSnapshot
    ? previousSnapshot.sourceRevision !== headSha
    : false;

  const stack = detectStack(repoRoot);
  const architecture = detectArchitecture(repoRoot);
  const dependencies = analyzeDependencies(repoRoot);
  const tests = analyzeTests(repoRoot);
  const risks = detectRisks(repoRoot);
  const openWork = detectOpenWork(repoRoot);
  const capabilities = detectCapabilities(repoRoot);

  return {
    projectId,
    repository: repository
      ? {
          provider: "github",
          owner: repository.owner,
          name: repository.name,
          defaultBranch: repository.defaultBranch,
          headSha,
        }
      : undefined,
    stack,
    architecture,
    capabilities,
    dependencies,
    tests,
    risks,
    openWork,
    scannedAt,
    sourceRevision: headSha,
    stale,
  };
}

// ─── Partial scan (for changed files only) ──────────────────────

export function partialScan(
  input: ScanInput & { changedFiles: string[] },
): Partial<ProjectIntelligenceSnapshot> {
  const { repoRoot, changedFiles, previousSnapshot } = input;
  if (!previousSnapshot) {
    return scanProject(input);
  }

  const headSha = getGitHeadSha(repoRoot);
  const scannedAt = new Date().toISOString();

  // Determine what needs re-scanning based on changed files
  const updates: Partial<ProjectIntelligenceSnapshot> = {
    scannedAt,
    sourceRevision: headSha,
    stale: false,
  };

  // If package.json changed, re-scan dependencies and stack
  if (changedFiles.includes("package.json")) {
    updates.dependencies = analyzeDependencies(repoRoot);
    updates.stack = detectStack(repoRoot);
  }

  // If test files changed, re-scan tests
  if (changedFiles.some((f) => f.includes(".test.") || f.includes(".spec."))) {
    updates.tests = analyzeTests(repoRoot);
  }

  // If API routes changed, re-scan architecture
  if (changedFiles.some((f) => f.includes("route.ts") || f.includes("route.tsx"))) {
    updates.architecture = detectArchitecture(repoRoot);
  }

  // If env files changed, re-scan risks
  if (changedFiles.some((f) => f.startsWith(".env"))) {
    updates.risks = detectRisks(repoRoot);
  }

  return updates;
}
