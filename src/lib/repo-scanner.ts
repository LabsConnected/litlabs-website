/**
 * Repository scanner — detects framework, package manager, commands, routes,
 * database config, API endpoints, environment variables, CI/CD, and more
 * from a GitHub repository file tree.
 *
 * SECURITY: This scanner NEVER reads or returns secret environment-variable
 * values. It only extracts variable NAMES from .env.example, .env.local,
 * docker-compose, and code files. Secret values are never fetched or stored.
 */

import type { Octokit } from "@octokit/rest";

export type ScanResult = {
  framework: string | null;
  packageManager: string | null;
  rootDirectory: string;
  developmentCommand: string | null;
  buildCommand: string | null;
  testCommand: string | null;
  installCommand: string | null;
  lintCommand: string | null;
  routes: string[];
  apiEndpoints: string[];
  database: {
    type: string | null;
    config: string[];
  };
  environmentVariables: string[];
  ciConfig: {
    platform: string | null;
    workflows: string[];
  };
  deployment: {
    platform: string | null;
    config: string[];
  };
  sourceDirectories: string[];
  importantFiles: string[];
  agents: {
    type: string;
    path: string;
  }[];
  prompts: {
    type: string;
    path: string;
  }[];
  aiIntegrations: string[];
  typescriptErrors: number | null;
  eslintErrors: number | null;
  readme: {
    path: string | null;
    setupInstructions: string[];
  };
  defaultBranch: string;
  latestCommitSha: string | null;
  fileCount: number;
  scanSummary: {
    scannedAt: string;
    commitSha: string | null;
    detected: string[];
  };
};

type TreeItem = {
  path: string;
  type: string;
  size?: number;
};

const IGNORED_DIRS = [
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".turbo",
  "coverage",
  ".cache",
  "__pycache__",
  ".pytest_cache",
  "venv",
  ".venv",
  "vendor",
  "target",
  "bin",
  "obj",
  ".gradle",
  ".idea",
  ".vscode",
  "*.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
];

const IMPORTANT_FILES = [
  "package.json",
  "tsconfig.json",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "vite.config.ts",
  "vite.config.js",
  "webpack.config.js",
  "vite.config.ts",
  "nuxt.config.ts",
  "remix.config.js",
  "astro.config.mjs",
  "svelte.config.js",
  "angular.json",
  "Cargo.toml",
  "go.mod",
  "requirements.txt",
  "pyproject.toml",
  "Pipfile",
  "Gemfile",
  "pom.xml",
  "build.gradle",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "vercel.json",
  "netlify.toml",
  ".env.example",
  ".env.local.example",
  "README.md",
  "README",
  "readme.md",
  "AGENTS.md",
  "CLAUDE.md",
  ".cursorrules",
  ".clinerules",
  "supabase/schema.sql",
  "prisma/schema.prisma",
  "drizzle.config.ts",
  "schema.prisma",
  ".github/workflows",
];

function isIgnored(path: string): boolean {
  return IGNORED_DIRS.some((d) => {
    if (d.includes("*")) {
      const pattern = d.replace(/\./g, "\\.").replace(/\*/g, ".*");
      return new RegExp(pattern).test(path);
    }
    return path.startsWith(d + "/") || path === d;
  });
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1];
}

/**
 * Detect framework from file tree.
 */
function detectFramework(items: TreeItem[]): string | null {
  const paths = new Set(items.map((i) => i.path));
  const hasPackageJson = paths.has("package.json");

  if (hasPackageJson) {
    if (paths.has("next.config.js") || paths.has("next.config.mjs") || paths.has("next.config.ts"))
      return "Next.js";
    if (paths.has("nuxt.config.ts") || paths.has("nuxt.config.js")) return "Nuxt";
    if (paths.has("remix.config.js") || paths.has("remix.config.ts")) return "Remix";
    if (paths.has("astro.config.mjs") || paths.has("astro.config.ts")) return "Astro";
    if (paths.has("svelte.config.js")) return "SvelteKit";
    if (paths.has("vite.config.ts") || paths.has("vite.config.js")) return "Vite";
    if (paths.has("angular.json")) return "Angular";
    if (paths.has("gatsby-config.js") || paths.has("gatsby-config.ts")) return "Gatsby";
    if (paths.has("craco.config.js") || paths.has("craco.config.ts")) return "React (CRACO)";
    // Fallback: check package.json for react
    return "React";
  }

  if (paths.has("Cargo.toml")) return "Rust";
  if (paths.has("go.mod")) return "Go";
  if (paths.has("requirements.txt") || paths.has("pyproject.toml") || paths.has("Pipfile"))
    return "Python";
  if (paths.has("Gemfile")) return "Ruby";
  if (paths.has("pom.xml") || paths.has("build.gradle")) return "Java";
  if (paths.has("pubspec.yaml")) return "Flutter";
  if (paths.has("composer.json")) return "PHP";
  return null;
}

/**
 * Detect package manager from lockfiles and config.
 */
function detectPackageManager(items: TreeItem[]): string | null {
  const paths = new Set(items.map((i) => i.path));
  if (paths.has("pnpm-lock.yaml") || paths.has("pnpm-workspace.yaml")) return "pnpm";
  if (paths.has("bun.lockb") || paths.has("bun.lock")) return "bun";
  if (paths.has("yarn.lock")) return "yarn";
  if (paths.has("package-lock.json")) return "npm";
  if (paths.has("Cargo.lock")) return "cargo";
  if (paths.has("go.sum")) return "go mod";
  if (paths.has("poetry.lock")) return "poetry";
  if (paths.has("Pipfile.lock")) return "pipenv";
  if (paths.has("Gemfile.lock")) return "bundler";
  if (paths.has("composer.lock")) return "composer";
  return null;
}

/**
 * Parse package.json scripts to extract commands.
 * SECURITY: Only reads scripts field, never reads dependencies values.
 */
function parsePackageJsonScripts(
  pkg: Record<string, unknown>,
  pm: string | null,
): {
  dev: string | null;
  build: string | null;
  test: string | null;
  install: string | null;
  lint: string | null;
} {
  const scripts = (pkg.scripts ?? {}) as Record<string, string>;
  const pmPrefix = pm === "pnpm" ? "pnpm" : pm === "yarn" ? "yarn" : pm === "bun" ? "bun" : "npm run";

  const dev = scripts.dev ? `${pmPrefix} dev` : null;
  const build = scripts.build ? `${pmPrefix} build` : null;
  const test = scripts.test && scripts.test !== "echo \"Error: no test specified\" && exit 1"
    ? `${pmPrefix} test`
    : null;
  const lint = scripts.lint ? `${pmPrefix} lint` : null;
  const install = pm === "pnpm" ? "pnpm install" : pm === "yarn" ? "yarn install" : pm === "bun" ? "bun install" : "npm install";

  return { dev, build, test, install, lint };
}

/**
 * Detect application routes from Next.js app router or pages router.
 */
function detectRoutes(items: TreeItem[]): string[] {
  const routes: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (item.type !== "blob") continue;
    const path = item.path;

    // Next.js App Router: src/app/**/page.{tsx,ts,jsx,js} or app/**/page.*
    const appMatch = path.match(/^(?:src\/)?app\/(.*)\/page\.(tsx|ts|jsx|js)$/);
    if (appMatch) {
      const segment = appMatch[1];
      const route = segment === "" || segment === "(home)" ? "/" : `/${segment}`;
      if (!seen.has(route)) {
        seen.add(route);
        routes.push(route);
      }
      continue;
    }

    // Next.js Pages Router: pages/**/*.tsx
    const pagesMatch = path.match(/^(?:src\/)?pages\/(.*)\.(tsx|ts|jsx|js)$/);
    if (pagesMatch) {
      const segment = pagesMatch[1].replace(/\/index$/, "");
      const route = segment === "" || segment === "index" ? "/" : `/${segment}`;
      if (!seen.has(route)) {
        seen.add(route);
        routes.push(route);
      }
      continue;
    }

    // SvelteKit routes
    const svelteMatch = path.match(/^src\/routes\/(.*)\/\+page\.svelte$/);
    if (svelteMatch) {
      const segment = svelteMatch[1];
      const route = segment === "" ? "/" : `/${segment}`;
      if (!seen.has(route)) {
        seen.add(route);
        routes.push(route);
      }
    }
  }

  return routes.sort();
}

/**
 * Detect API endpoints from Next.js route handlers, Express, etc.
 */
function detectApiEndpoints(items: TreeItem[]): string[] {
  const endpoints: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (item.type !== "blob") continue;
    const path = item.path;

    // Next.js App Router API: app/api/**/route.{ts,tsx,js}
    const apiMatch = path.match(/^(?:src\/)?app\/api\/(.*)\/route\.(ts|tsx|js)$/);
    if (apiMatch) {
      const segment = apiMatch[1];
      const endpoint = `/api/${segment}`;
      if (!seen.has(endpoint)) {
        seen.add(endpoint);
        endpoints.push(endpoint);
      }
    }
  }

  return endpoints.sort();
}

/**
 * Detect database configuration.
 * SECURITY: Only detects type and config file paths, never reads values.
 */
function detectDatabase(items: TreeItem[]): { type: string | null; config: string[] } {
  const paths = new Set(items.map((i) => i.path));
  const config: string[] = [];
  let type: string | null = null;

  if (paths.has("supabase/schema.sql") || paths.has("supabase/config.toml")) {
    type = "Supabase";
    if (paths.has("supabase/schema.sql")) config.push("supabase/schema.sql");
    if (paths.has("supabase/config.toml")) config.push("supabase/config.toml");
  }
  if (paths.has("prisma/schema.prisma")) {
    type = type ? `${type} + Prisma` : "Prisma";
    config.push("prisma/schema.prisma");
  }
  if (paths.has("drizzle.config.ts") || paths.has("drizzle.config.js")) {
    type = type ? `${type} + Drizzle` : "Drizzle";
    config.push("drizzle.config.ts");
  }
  // Check for mongoose/mongodb in file names
  for (const item of items) {
    if (item.path.includes("mongoose") && !type) {
      type = "MongoDB";
      break;
    }
  }
  // Check for SQL migration directories
  if (items.some((i) => i.path.startsWith("migrations/") || i.path.startsWith("db/migrations/"))) {
    if (!type) type = "SQL Migrations";
    config.push("migrations/");
  }

  return { type, config };
}

/**
 * Extract environment variable NAMES from .env.example, .env.local.example,
 * docker-compose, and code files.
 * SECURITY: Only extracts variable NAMES, never values.
 */
function extractEnvVarNames(items: TreeItem[], octokit: Octokit, owner: string, repo: string, ref: string): Promise<string[]> {
  const envFiles = items.filter(
    (i) =>
      i.type === "blob" &&
      (basename(i.path) === ".env.example" ||
        basename(i.path) === ".env.local.example" ||
        basename(i.path) === ".env.template" ||
        basename(i.path) === ".env.sample"),
  );

  const names = new Set<string>();

  // Also scan docker-compose for environment keys
  const composeFiles = items.filter(
    (i) => i.type === "blob" && (basename(i.path) === "docker-compose.yml" || basename(i.path) === "docker-compose.yaml"),
  );

  const filesToFetch = [...envFiles, ...composeFiles];

  // Limit to first 5 files to avoid rate limits
  const limited = filesToFetch.slice(0, 5);

  return Promise.all(
    limited.map(async (file) => {
      try {
        const { data } = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: file.path,
          ref,
        });
        if ("content" in data && data.content) {
          const text = Buffer.from(data.content, "base64").toString("utf-8");
          // Match ENV_VAR_NAME= or ENV_VAR_NAME: (yaml)
          const matches = text.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*[=:]/gm);
          for (const match of matches) {
            names.add(match[1]);
          }
        }
      } catch {
        // skip unreadable files
      }
    }),
  ).then(() => Array.from(names).sort());
}

/**
 * Detect CI/CD configuration.
 */
function detectCI(items: TreeItem[]): { platform: string | null; workflows: string[] } {
  const workflows: string[] = [];
  let platform: string | null = null;

  for (const item of items) {
    if (item.path.startsWith(".github/workflows/") && item.type === "blob") {
      platform = "GitHub Actions";
      workflows.push(item.path);
    }
    if (item.path === ".gitlab-ci.yml") {
      platform = "GitLab CI";
      workflows.push(item.path);
    }
    if (item.path === ".circleci/config.yml") {
      platform = "CircleCI";
      workflows.push(item.path);
    }
    if (item.path === "Jenkinsfile") {
      platform = "Jenkins";
      workflows.push(item.path);
    }
  }

  return { platform, workflows };
}

/**
 * Detect deployment configuration.
 */
function detectDeployment(items: TreeItem[]): { platform: string | null; config: string[] } {
  const paths = new Set(items.map((i) => i.path));
  const config: string[] = [];
  let platform: string | null = null;

  if (paths.has("vercel.json")) {
    platform = "Vercel";
    config.push("vercel.json");
  }
  if (paths.has("netlify.toml")) {
    platform = platform ? `${platform} + Netlify` : "Netlify";
    config.push("netlify.toml");
  }
  if (paths.has("Dockerfile")) {
    platform = platform ? `${platform} + Docker` : "Docker";
    config.push("Dockerfile");
  }
  if (paths.has("docker-compose.yml") || paths.has("docker-compose.yaml")) {
    platform = platform ? `${platform} + Docker Compose` : "Docker Compose";
    config.push("docker-compose.yml");
  }
  if (paths.has("fly.toml")) {
    platform = platform ? `${platform} + Fly.io` : "Fly.io";
    config.push("fly.toml");
  }
  if (paths.has("railway.json") || paths.has("railway.toml")) {
    platform = platform ? `${platform} + Railway` : "Railway";
    config.push("railway.json");
  }
  if (paths.has("render.yaml")) {
    platform = platform ? `${platform} + Render` : "Render";
    config.push("render.yaml");
  }

  return { platform, config };
}

/**
 * Detect source directories.
 */
function detectSourceDirs(items: TreeItem[]): string[] {
  const dirs = new Set<string>();
  const topDirs = new Set<string>();

  for (const item of items) {
    if (item.type !== "blob") continue;
    const parts = item.path.split("/");
    if (parts.length > 1) {
      topDirs.add(parts[0]);
    }
    // Track common source dirs
    if (item.path.startsWith("src/")) dirs.add("src/");
    if (item.path.startsWith("app/")) dirs.add("app/");
    if (item.path.startsWith("lib/")) dirs.add("lib/");
    if (item.path.startsWith("components/")) dirs.add("components/");
    if (item.path.startsWith("pages/")) dirs.add("pages/");
    if (item.path.startsWith("server/")) dirs.add("server/");
    if (item.path.startsWith("api/")) dirs.add("api/");
    if (item.path.startsWith("tests/") || item.path.startsWith("test/")) dirs.add("tests/");
  }

  return Array.from(dirs).sort();
}

/**
 * Detect important files present in the repo.
 */
function detectImportantFiles(items: TreeItem[]): string[] {
  const paths = new Set(items.map((i) => i.path));
  return IMPORTANT_FILES.filter((f) => {
    if (f.endsWith("/")) {
      return items.some((i) => i.path.startsWith(f));
    }
    return paths.has(f);
  });
}

/**
 * Detect existing AI agents, prompts, and integrations.
 */
function detectAgentsAndPrompts(items: TreeItem[]): {
  agents: { type: string; path: string }[];
  prompts: { type: string; path: string }[];
  aiIntegrations: string[];
} {
  const agents: { type: string; path: string }[] = [];
  const prompts: { type: string; path: string }[] = [];
  const aiIntegrations = new Set<string>();

  for (const item of items) {
    if (item.type !== "blob") continue;
    const name = basename(item.path);

    // Agent config files
    if (name === "AGENTS.md") agents.push({ type: "AGENTS.md", path: item.path });
    if (name === "CLAUDE.md") agents.push({ type: "CLAUDE.md", path: item.path });
    if (name === ".cursorrules") agents.push({ type: "Cursor Rules", path: item.path });
    if (name === ".clinerules") agents.push({ type: "Cline Rules", path: item.path });
    if (name === "AGENT.md" || name === "agent.md") agents.push({ type: "Agent", path: item.path });
    if (item.path.startsWith(".devin/")) agents.push({ type: "Devin", path: item.path });
    if (item.path.startsWith(".agents/")) agents.push({ type: "Agents Dir", path: item.path });

    // Prompt files
    if (name.endsWith(".prompt") || name.endsWith(".prompt.md") || name.endsWith(".prompt.txt"))
      prompts.push({ type: "prompt", path: item.path });
    if (item.path.includes("/prompts/") && (name.endsWith(".md") || name.endsWith(".txt")))
      prompts.push({ type: "prompt", path: item.path });
    if (item.path.includes("/system-prompts/") || item.path.includes("/system_prompts/"))
      prompts.push({ type: "system-prompt", path: item.path });

    // AI integration indicators
    if (name === "openai" || item.path.includes("openai")) aiIntegrations.add("OpenAI");
    if (item.path.includes("anthropic") || item.path.includes("claude")) aiIntegrations.add("Anthropic");
    if (item.path.includes("gemini") || item.path.includes("google-ai")) aiIntegrations.add("Gemini");
    if (item.path.includes("openrouter")) aiIntegrations.add("OpenRouter");
    if (item.path.includes("langchain")) aiIntegrations.add("LangChain");
    if (item.path.includes("vercel-ai-sdk") || item.path.includes("ai-sdk")) aiIntegrations.add("Vercel AI SDK");
    if (item.path.includes("together-ai") || item.path.includes("togetherai")) aiIntegrations.add("Together AI");
    if (item.path.includes("fal") || item.path.includes("fal-ai")) aiIntegrations.add("Fal.ai");
  }

  return {
    agents: agents.sort((a, b) => a.path.localeCompare(b.path)),
    prompts: prompts.sort((a, b) => a.path.localeCompare(b.path)),
    aiIntegrations: Array.from(aiIntegrations).sort(),
  };
}

/**
 * Fetch README and extract setup instructions.
 */
async function fetchReadmeSetup(
  items: TreeItem[],
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string,
): Promise<{ path: string | null; setupInstructions: string[] }> {
  const readme = items.find(
    (i) =>
      i.type === "blob" &&
      ["README.md", "readme.md", "README", "README.rst", "README.txt"].includes(basename(i.path)),
  );

  if (!readme) return { path: null, setupInstructions: [] };

  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: readme.path,
      ref,
    });
    if (!("content" in data) || !data.content) {
      return { path: readme.path, setupInstructions: [] };
    }
    const text = Buffer.from(data.content, "base64").toString("utf-8");
    // Extract lines that look like setup/install instructions
    const instructions: string[] = [];
    const lines = text.split("\n");
    let inSetup = false;
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (lower.includes("## setup") || lower.includes("## installation") || lower.includes("## getting started") || lower.includes("## install")) {
        inSetup = true;
        continue;
      }
      if (inSetup && line.startsWith("## ")) {
        inSetup = false;
        continue;
      }
      if (inSetup && line.trim()) {
        // Extract command-like lines or bullet points
        if (line.includes("```") || line.startsWith("- ") || line.startsWith("1. ") || line.startsWith("npm ") || line.startsWith("pnpm ") || line.startsWith("yarn ") || line.startsWith("bun ") || line.startsWith("git ") || line.startsWith("cp ") || line.startsWith("export ")) {
          instructions.push(line.trim().replace(/^[-\d.]+\s*/, ""));
        }
      }
    }
    return { path: readme.path, setupInstructions: instructions.slice(0, 20) };
  } catch {
    return { path: readme.path, setupInstructions: [] };
  }
}

/**
 * Main scan function. Fetches the repo tree and analyzes it.
 */
export async function scanRepository(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
): Promise<ScanResult> {
  // Get the latest commit SHA for this branch
  const { data: branchData } = await octokit.rest.repos.getBranch({
    owner,
    repo,
    branch,
  });
  const latestCommitSha = branchData.commit.sha;

  // Get the full file tree (recursive)
  const { data: treeData } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: latestCommitSha,
    recursive: "1",
  });

  const allItems: TreeItem[] = (treeData.tree || []).map((t) => ({
    path: t.path ?? "",
    type: t.type ?? "blob",
    size: t.size,
  }));

  // Filter out ignored directories
  const items = allItems.filter((i) => !isIgnored(i.path));

  // Detect framework and package manager
  const framework = detectFramework(items);
  const packageManager = detectPackageManager(items);

  // Parse package.json for scripts if present
  let dev: string | null = null;
  let build: string | null = null;
  let test: string | null = null;
  let install: string | null = null;
  let lint: string | null = null;

  const pkgFile = items.find((i) => i.path === "package.json");
  if (pkgFile) {
    try {
      const { data: pkgData } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: "package.json",
        ref: latestCommitSha,
      });
      if ("content" in pkgData && pkgData.content) {
        const pkg = JSON.parse(Buffer.from(pkgData.content, "base64").toString("utf-8"));
        const cmds = parsePackageJsonScripts(pkg, packageManager);
        dev = cmds.dev;
        build = cmds.build;
        test = cmds.test;
        install = cmds.install;
        lint = cmds.lint;
      }
    } catch {
      // skip unreadable package.json
    }
  }

  // Non-JS defaults
  if (!install && framework === "Rust") install = "cargo build";
  if (!install && framework === "Go") install = "go mod download";
  if (!install && framework === "Python") install = "pip install -r requirements.txt";
  if (!build && framework === "Rust") build = "cargo build --release";
  if (!build && framework === "Go") build = "go build ./...";

  // Routes and API endpoints
  const routes = detectRoutes(items);
  const apiEndpoints = detectApiEndpoints(items);

  // Database
  const database = detectDatabase(items);

  // Environment variables (names only, never values)
  const environmentVariables = await extractEnvVarNames(items, octokit, owner, repo, latestCommitSha);

  // CI/CD and deployment
  const ciConfig = detectCI(items);
  const deployment = detectDeployment(items);

  // Source directories and important files
  const sourceDirectories = detectSourceDirs(items);
  const importantFiles = detectImportantFiles(items);

  // Agents and prompts
  const { agents, prompts, aiIntegrations } = detectAgentsAndPrompts(items);

  // README
  const readme = await fetchReadmeSetup(items, octokit, owner, repo, latestCommitSha);

  // Build scan summary
  const detected: string[] = [];
  if (framework) detected.push(`framework:${framework}`);
  if (packageManager) detected.push(`pm:${packageManager}`);
  if (database.type) detected.push(`db:${database.type}`);
  if (ciConfig.platform) detected.push(`ci:${ciConfig.platform}`);
  if (deployment.platform) detected.push(`deploy:${deployment.platform}`);
  if (routes.length) detected.push(`routes:${routes.length}`);
  if (apiEndpoints.length) detected.push(`api:${apiEndpoints.length}`);
  if (environmentVariables.length) detected.push(`env:${environmentVariables.length}`);
  if (agents.length) detected.push(`agents:${agents.length}`);
  if (aiIntegrations.length) detected.push(`ai:${aiIntegrations.length}`);

  return {
    framework,
    packageManager,
    rootDirectory: ".",
    developmentCommand: dev,
    buildCommand: build,
    testCommand: test,
    installCommand: install,
    lintCommand: lint,
    routes,
    apiEndpoints,
    database,
    environmentVariables,
    ciConfig,
    deployment,
    sourceDirectories,
    importantFiles,
    agents,
    prompts,
    aiIntegrations,
    typescriptErrors: null, // requires running tsc, not done in scan
    eslintErrors: null, // requires running eslint, not done in scan
    readme,
    defaultBranch: branch,
    latestCommitSha,
    fileCount: items.filter((i) => i.type === "blob").length,
    scanSummary: {
      scannedAt: new Date().toISOString(),
      commitSha: latestCommitSha,
      detected,
    },
  };
}

/**
 * Convert a ScanResult to the scan_summary jsonb stored in studio_projects.
 */
export function scanResultToSummary(result: ScanResult): Record<string, unknown> {
  return {
    framework: result.framework,
    packageManager: result.packageManager,
    routes: result.routes,
    apiEndpoints: result.apiEndpoints,
    database: result.database,
    environmentVariables: result.environmentVariables,
    ciConfig: result.ciConfig,
    deployment: result.deployment,
    sourceDirectories: result.sourceDirectories,
    importantFiles: result.importantFiles,
    agents: result.agents,
    prompts: result.prompts,
    aiIntegrations: result.aiIntegrations,
    readme: result.readme,
    fileCount: result.fileCount,
    scanSummary: result.scanSummary,
  };
}
