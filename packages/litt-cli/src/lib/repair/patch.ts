import { access, lstat, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { z } from "zod";
import { hasUnsafePathSyntax, isProtectedRepairPath } from "./workspace-policy.js";

const patchBase = z.object({
  path: z.string().trim().min(1).max(260),
});

export const contextPatchSchema = z.discriminatedUnion("operation", [
  patchBase.extend({
    operation: z.literal("create"),
    content: z.string().max(262_144),
  }).strict(),
  patchBase.extend({
    operation: z.literal("replace"),
    search: z.string().min(1).max(131_072),
    replacement: z.string().max(262_144),
  }).strict(),
]);

export type ContextPatch = z.infer<typeof contextPatchSchema>;

interface PreparedPatch {
  path: string;
  previous: string | null;
  next: string;
}

export async function applyContextPatches(
  root: string,
  rawPatches: unknown[],
  editablePaths: readonly string[],
  frozenPaths: ReadonlySet<string> = new Set(),
): Promise<string[]> {
  const parsed = z.array(contextPatchSchema).min(1).max(16).safeParse(rawPatches);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid patch");

  const prepared = await Promise.all(parsed.data.map((patch) =>
    preparePatch(root, patch, editablePaths, frozenPaths),
  ));
  const changed: PreparedPatch[] = [];
  try {
    for (const patch of prepared) {
      await writeFile(patch.path, patch.next, "utf8");
      changed.push(patch);
    }
  } catch (error) {
    await rollback(changed);
    throw error;
  }
  return prepared.map((patch) => normalizeRelative(root, patch.path));
}

async function preparePatch(
  root: string,
  patch: ContextPatch,
  editablePaths: readonly string[],
  frozenPaths: ReadonlySet<string>,
): Promise<PreparedPatch> {
  const normalized = patch.path.replace(/\\/g, "/");
  assertAuthorized(normalized, editablePaths, frozenPaths);
  const target = resolve(root, normalized);
  assertLexicallyInside(root, target);
  await assertParentInside(root, dirname(target));

  if (patch.operation === "create") {
    if (await pathExists(target)) throw new Error("Create target already exists: " + normalized);
    return { path: target, previous: null, next: patch.content };
  }

  // A symlinked target would let a lexically in-scope path write outside the workspace.
  if ((await lstat(target)).isSymbolicLink()) {
    throw new Error("Symbolic link targets cannot be patched: " + normalized);
  }
  const previous = await readFile(target, "utf8");
  const first = previous.indexOf(patch.search);
  if (first < 0) throw new Error("Patch context not found: " + normalized);
  if (previous.indexOf(patch.search, first + patch.search.length) >= 0) {
    throw new Error("Patch context is not unique: " + normalized);
  }
  return {
    path: target,
    previous,
    next: previous.slice(0, first) + patch.replacement + previous.slice(first + patch.search.length),
  };
}

function assertAuthorized(
  path: string,
  editablePaths: readonly string[],
  frozenPaths: ReadonlySet<string>,
): void {
  if (path.startsWith("/") || /^[a-z]:\//i.test(path) || path.split("/").includes("..")) {
    throw new Error("Patch path must remain inside the workspace");
  }
  if (hasUnsafePathSyntax(path)) throw new Error("Unsafe path syntax cannot be patched: " + path);
  if (isProtectedRepairPath(path)) throw new Error("Protected path cannot be patched: " + path);
  if (frozenPaths.has(path.toLowerCase())) throw new Error("Frozen path cannot be patched: " + path);
  const isEditable = editablePaths.some((scope) => {
    const normalizedScope = scope.replace(/\\/g, "/").replace(/\/+$/, "");
    return path === normalizedScope || path.startsWith(normalizedScope + "/");
  });
  if (!isEditable) throw new Error("Path is outside editable scopes: " + path);
}

function assertLexicallyInside(root: string, target: string): void {
  const fromRoot = relative(resolve(root), target);
  if (fromRoot === ".." || fromRoot.startsWith("../") || fromRoot.startsWith("..\\")) {
    throw new Error("Patch target resolves outside workspace");
  }
}

async function assertParentInside(root: string, parent: string): Promise<void> {
  const { realpath } = await import("node:fs/promises");
  const canonicalRoot = await realpath(root);
  const canonicalParent = await realpath(parent);
  assertLexicallyInside(canonicalRoot, canonicalParent);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function rollback(changed: PreparedPatch[]): Promise<void> {
  const { rm } = await import("node:fs/promises");
  for (const patch of [...changed].reverse()) {
    if (patch.previous === null) {
      await rm(patch.path, { force: true });
    } else {
      await writeFile(patch.path, patch.previous, "utf8");
    }
  }
}

function normalizeRelative(root: string, target: string): string {
  return relative(root, target).replace(/\\/g, "/");
}
