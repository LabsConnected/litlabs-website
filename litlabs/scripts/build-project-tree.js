const {
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} = require("fs");
const { join, relative } = require("path");

const ROOTS = [
  "src/app",
  "src/components",
  "src/lib",
  "src/hooks",
  "src/context",
  "terminal-server",
];

const EXTRA_FILES = [
  "package.json",
  "README.md",
  "AGENTS.md",
  "vercel.json",
  "tsconfig.json",
];
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  ".git",
  "coverage",
  ".vercel",
  "out",
  "build",
]);
const MAX_FILE_BYTES = 12_000;
const MAX_FILES = 300;

const cwd = process.cwd();

function scanDir(base, dir, files, contents) {
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
            contents[relPath] = readFileSync(fullPath, "utf-8");
          }
        } catch {}
      }
    }
  } catch {}
}

function buildTree() {
  const tree = [];
  const contents = {};
  for (const dirName of ROOTS) {
    const dir = join(cwd, dirName);
    scanDir(cwd, dir, tree, contents);
  }
  for (const file of EXTRA_FILES) {
    const path = join(cwd, file);
    try {
      tree.push(file);
      contents[file] = readFileSync(path, "utf-8");
    } catch {}
  }
  return { tree, contents };
}

const data = buildTree();
mkdirSync(join(cwd, "public"), { recursive: true });
writeFileSync(
  join(cwd, "public", "project-tree.json"),
  JSON.stringify(data, null, 2),
);
console.log(
  `[build-project-tree] Wrote ${data.tree.length} entries to public/project-tree.json`,
);
