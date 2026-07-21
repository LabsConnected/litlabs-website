import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from "fs";
import { join, dirname, relative, basename } from "path";
import { createHash } from "crypto";
import { resolveWorkspacePath, isIgnoredDir, MAX_READ_SIZE, MAX_WRITE_SIZE } from "./WorkspaceSecurity";

export interface WorkspaceTreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  size?: number;
  children?: WorkspaceTreeNode[];
}

export interface WorkspaceFile {
  path: string;
  content: string;
  version: string;
  size: number;
}

export function listTree(
  root: string,
  dirPath: string = ".",
  depth: number = 3,
): WorkspaceTreeNode[] {
  const target = resolveWorkspacePath(root, dirPath);
  const entries = readdirSync(target, { withFileTypes: true });

  const nodes: WorkspaceTreeNode[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && isIgnoredDir(entry.name)) continue;
    const fullPath = join(target, entry.name);
    const relPath = relative(root, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      const node: WorkspaceTreeNode = {
        name: entry.name,
        path: relPath,
        type: "folder",
      };
      if (depth > 0) {
        try {
          node.children = listTree(root, relPath, depth - 1);
        } catch {
          node.children = [];
        }
      }
      nodes.push(node);
    } else if (entry.isFile()) {
      const stats = statSync(fullPath);
      nodes.push({
        name: entry.name,
        path: relPath,
        type: "file",
        size: stats.size,
      });
    }
  }

  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return nodes;
}

export function readFile(root: string, filePath: string): WorkspaceFile {
  const target = resolveWorkspacePath(root, filePath);
  const stats = statSync(target);
  if (!stats.isFile()) throw new Error("Not a file");
  if (stats.size > MAX_READ_SIZE) throw new Error(`File exceeds ${MAX_READ_SIZE} bytes`);

  const content = readFileSync(target, "utf-8");
  const version = createHash("sha256").update(content).digest("hex").slice(0, 16);

  return {
    path: relative(root, target).replace(/\\/g, "/"),
    content,
    version,
    size: stats.size,
  };
}

export function writeFile(
  root: string,
  filePath: string,
  content: string,
  expectedVersion?: string,
): WorkspaceFile {
  if (Buffer.byteLength(content, "utf8") > MAX_WRITE_SIZE) {
    throw new Error(`Content exceeds ${MAX_WRITE_SIZE} bytes`);
  }

  const target = resolveWorkspacePath(root, filePath);

  if (existsSync(target)) {
    const existing = readFileSync(target, "utf-8");
    const currentVersion = createHash("sha256").update(existing).digest("hex").slice(0, 16);
    if (expectedVersion && expectedVersion !== currentVersion) {
      throw new Error("Version mismatch — file was modified by another session");
    }
  }

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf-8");

  const version = createHash("sha256").update(content).digest("hex").slice(0, 16);
  return {
    path: relative(root, target).replace(/\\/g, "/"),
    content,
    version,
    size: Buffer.byteLength(content, "utf8"),
  };
}

export interface SearchResult {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export function searchFiles(
  root: string,
  query: string,
  maxResults: number = 50,
): SearchResult[] {
  if (!query || query.length < 2) return [];

  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();

  function walk(dir: string) {
    if (results.length >= maxResults) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= maxResults) return;
      if (entry.isDirectory() && isIgnoredDir(entry.name)) continue;

      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        try {
          const stats = statSync(fullPath);
          if (stats.size > MAX_READ_SIZE) continue;
          const content = readFileSync(fullPath, "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            const lowerLine = lines[i].toLowerCase();
            const col = lowerLine.indexOf(lowerQuery);
            if (col !== -1) {
              results.push({
                path: relative(root, fullPath).replace(/\\/g, "/"),
                line: i + 1,
                column: col + 1,
                preview: lines[i].slice(Math.max(0, col - 30), col + query.length + 30),
              });
              if (results.length >= maxResults) return;
            }
          }
        } catch {
          // skip binary or unreadable
        }
      }
    }
  }

  walk(root);
  return results;
}
