import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = process.cwd();

const EXCLUDED_DIRS = new Set([
  ".git",
  ".next",
  "node_modules",
  "dist",
  "chrome",
  "litlabs",
  "litlabs-website",
  "Zoo-Code",
  "work",
  "meta",
  ".temp",
  "jsdos",
  "showcase",
  "OmniRoute",
  "terminal-server",
  "cli",
  "docker",
  "tests",
  "electron",
  "bin",
  "open-sse",
]);

const EXCLUDED_FILE_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.example",
  ".gitignore",
  ".npmrc",
  ".nvmrc",
  ".eslintrc",
  ".eslintignore",
  ".prettierrc",
  ".prettierignore",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "next-env.d.ts",
  "tsconfig.tsbuildinfo",
  "tsc-out.txt",
  "tsc_errors.txt",
  "build.log",
  "deploy.log",
]);

const EXCLUDED_FILE_EXTS = new Set([".log", ".tsbuildinfo"]);

function shouldSkipFile(name: string) {
  if (name.startsWith(".")) return true;
  if (EXCLUDED_FILE_NAMES.has(name)) return true;
  const ext = path.extname(name).toLowerCase();
  if (EXCLUDED_FILE_EXTS.has(ext)) return true;
  return false;
}

function safeRead(filePath: string, maxChars = 50_000): string | null {
  try {
    let content = fs.readFileSync(path.join(PROJECT_ROOT, filePath), "utf-8");
    if (content.length > maxChars) {
      content =
        content.slice(0, maxChars) +
        `\n\n... [truncated; ${content.length - maxChars} additional characters]`;
    }
    return content;
  } catch {
    return null;
  }
}

function readDirTree(dir: string, prefix = ""): string {
  const fullPath = path.join(PROJECT_ROOT, dir);
  let tree = "";
  try {
    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        const relative = path.join(dir, entry.name);
        tree += `${prefix}${entry.name}/\n`;
        tree += readDirTree(relative, `${prefix}  `);
      } else {
        if (shouldSkipFile(entry.name)) continue;
        tree += `${prefix}${entry.name}\n`;
      }
    }
  } catch {
    // skip unreadable directories
  }
  return tree;
}

function readTopLevelTree(): string {
  let tree = "";
  try {
    const entries = fs.readdirSync(PROJECT_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        tree += `${entry.name}/\n`;
      } else {
        if (shouldSkipFile(entry.name)) continue;
        tree += `${entry.name}\n`;
      }
    }
  } catch {
    // skip unreadable root
  }
  return tree;
}

function readFilesContent(dir: string, maxCharsPerFile = 25_000): string {
  const fullPath = path.join(PROJECT_ROOT, dir);
  let content = "";
  try {
    const entries = fs.readdirSync(fullPath, { withFileTypes: true, recursive: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (entry.name.startsWith(".")) continue;
      const parent = "path" in entry && typeof entry.path === "string"
        ? entry.path
        : fullPath;
      const relative = path.relative(PROJECT_ROOT, path.join(parent, entry.name));
      const text = safeRead(relative, maxCharsPerFile);
      if (text) {
        content += `\n\n--- ${relative} ---\n${text}`;
      }
    }
  } catch {
    // skip unreadable directories
  }
  return content;
}

function packageJsonSummary(): string {
  const raw = safeRead("package.json", 100_000);
  if (!raw) return "(package.json not found)";
  try {
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    return JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        scripts: pkg.scripts,
        dependencies: pkg.dependencies,
        devDependencies: pkg.devDependencies,
        packageManager: pkg.packageManager,
      },
      null,
      2,
    );
  } catch {
    return raw;
  }
}

function buildProjectContext(): string {
  const readme = safeRead("README.md", 25_000) ?? "(README.md not found)";
  const pkg = packageJsonSummary();
  const nextConfig = safeRead("next.config.ts", 25_000) ?? "(next.config.ts not found)";
  const tsConfig = safeRead("tsconfig.json", 10_000) ?? "(tsconfig.json not found)";
  const srcTree = readDirTree("src");
  const docsContent = readFilesContent("docs", 25_000);
  const prdsContent = readFilesContent("prds", 25_000);
  const schemaSql = safeRead("supabase/schema.sql", 25_000) ?? "(supabase/schema.sql not found)";
  const supabaseTree = readDirTree("supabase");
  const publicTree = readDirTree("public");
  const topLevelTree = readTopLevelTree();

  // AI/environment context files (names/structure only, no secret values)
  const envExample = safeRead(".env.example", 10_000) ?? "(.env.example not found)";
  const clineRules = safeRead(".clinerules", 25_000) ?? "(.clinerules not found)";
  const cursorRules = safeRead(".cursorrules", 25_000) ?? "(.cursorrules not found)";
  const devinConfig = safeRead(".devin-config.json", 10_000) ?? "(.devin-config.json not found)";
  const agentsMd = safeRead("AGENTS.md", 25_000) ?? "(AGENTS.md not found)";

  const sections = [
    "=== Project README ===",
    readme,
    "=== package.json ===",
    pkg,
    "=== next.config.ts ===",
    nextConfig,
    "=== tsconfig.json ===",
    tsConfig,
    "=== src/ file tree ===",
    srcTree,
    "=== docs/ contents ===",
    docsContent || "(docs/ not found or empty)",
    "=== prds/ contents ===",
    prdsContent || "(prds/ not found or empty)",
    "=== supabase/schema.sql ===",
    schemaSql,
    "=== supabase/ tree ===",
    supabaseTree,
    "=== public/ tree ===",
    publicTree,
    "=== top-level tree ===",
    topLevelTree,
    "=== .env.example (environment variable names) ===",
    envExample,
    "=== .clinerules (AI environment context) ===",
    clineRules,
    "=== .cursorrules (AI environment context) ===",
    cursorRules,
    "=== .devin-config.json ===",
    devinConfig,
    "=== AGENTS.md (project guide) ===",
    agentsMd,
  ];

  return sections.join("\n\n");
}

/**
 * Full project snapshot for server-side prompts.
 * Safe to import only from API routes / server components.
 */
export const PROJECT_CONTEXT = buildProjectContext();

/**
 * Returns a slice of the full context. Use this when a route needs a smaller
 * prompt window.
 */
export function getProjectContext(maxChars = PROJECT_CONTEXT.length): string {
  return PROJECT_CONTEXT.slice(0, maxChars);
}

export function getProjectFileTree(dir = "src"): string {
  return readDirTree(dir);
}
