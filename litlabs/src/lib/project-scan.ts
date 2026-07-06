import { readdirSync, statSync, readFileSync } from "fs";
import { join, relative } from "path";

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".git", "coverage", ".vercel", "out", "build"]);
const MAX_FILE_BYTES = 12_000;
const MAX_FILES = 300;

let cachedFileTree: string[] | null = null;
let cachedFileContents: Map<string, string> | null = null;

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
        } catch { }
      }
    }
  } catch { }
}

export function getProjectFiles(): { tree: string[]; contents: Map<string, string> } {
  if (cachedFileTree && cachedFileContents) {
    return { tree: cachedFileTree, contents: cachedFileContents };
  }
  const cwd = process.cwd();
  const tree: string[] = [];
  const contents = new Map<string, string>();
  const roots = [
    join(cwd, "src", "app"),
    join(cwd, "src", "components"),
    join(cwd, "src", "lib"),
    join(cwd, "src", "hooks"),
    join(cwd, "src", "context"),
    join(cwd, "terminal-server"),
  ];
  for (const dir of roots) {
    scanDir(cwd, dir, tree, contents);
  }
  for (const file of ["package.json", "README.md", "AGENTS.md", "vercel.json", "tsconfig.json"]) {
    const path = join(cwd, file);
    try {
      tree.push(file);
      contents.set(file, readFileSync(path, "utf-8"));
    } catch { }
  }
  cachedFileTree = tree;
  cachedFileContents = contents;
  return { tree, contents };
}
