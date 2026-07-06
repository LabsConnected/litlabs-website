import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, relative } from "path";

const ROOTS = [
  ["src/app", "src/app"],
  ["src/components", "src/components"],
  ["src/lib", "src/lib"],
  ["src/hooks", "src/hooks"],
  ["src/context", "src/context"],
  ["terminal-server", "terminal-server"],
] as const;

const EXTRA_FILES = ["package.json", "README.md", "AGENTS.md", "vercel.json", "tsconfig.json"];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".git", "coverage", ".vercel", "out", "build"]);
const MAX_FILE_BYTES = 12_000;
const MAX_FILES = 300;

const cwd = process.cwd();

function scanDir(base: string, dir: string, files: string[], contents: Map<string, string>) {
  if (files.length >= MAX_FILES) return;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      const relPath = relative(base, fullPath);
      if (entry.isDirectory()) {
        files.push(`${relPath}/`);
        scanDir(base, fullPath, files, contents);
      } else if (entry.isFile()) {
        files.push(relPath);
        try {
          const size = statSync(fullPath).size;
          if (size <= MAX_FILE_BYTES) {
            contents.set(relPath, readFileSync(fullPath, "utf-8"));
          }
        } catch {}
      }
    }
  } catch {}
}

function buildTree() {
  const tree: string[] = [];
  const contents = new Map<string, string>();
  for (const [dirName] of ROOTS) {
    const dir = join(cwd, dirName);
    scanDir(cwd, dir, tree, contents);
  }
  for (const file of EXTRA_FILES) {
    const path = join(cwd, file);
    try {
      tree.push(file);
      contents.set(file, readFileSync(path, "utf-8"));
    } catch {}
  }
  const contentsObj: Record<string, string> = {};
  for (const [k, v] of contents.entries()) contentsObj[k] = v;
  return { tree, contents: contentsObj };
}

const data = buildTree();
mkdirSync(join(cwd, "public"), { recursive: true });
writeFileSync(join(cwd, "public", "project-tree.json"), JSON.stringify(data, null, 2));
console.log(`[build-project-tree] Wrote ${data.tree.length} entries to public/project-tree.json`);
