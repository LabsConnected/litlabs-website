/**
 * htmlProjectSyncPolicy — pure functions for HTML project sync logic.
 *
 * Extracted from useHtmlProjectSync so they can be unit-tested directly
 * without mocking fetch or mounting React. The hook imports these and
 * wires them into the React lifecycle.
 *
 * Contracts:
 *   - fetchServerFile: 404 = missing file (exists=false), 500/401/403/network = hard error (throws)
 *   - writeServerFile: any non-2xx = hard error (throws)
 *   - loadServerFiles: uses Promise.all — any hard read error aborts the load
 *   - reconcileLoad: server-empty + local-cache = explicit recovery decision, not silent
 */

import type { HtmlFile, HtmlProject, HtmlFileLanguage } from "./projectTypes";

export const HTML_FILES = ["index.html", "style.css", "script.js"] as const;
export const SAVE_DEBOUNCE_MS = 1500;
export const CACHE_KEY_PREFIX = "litt:canvasBuilder:htmlProject:";

// Re-export the canonical types so callers can import from either module
export type { HtmlFile, HtmlProject };

/** Infer the language from a filename. */
function languageForFile(name: string): HtmlFileLanguage {
  if (name.endsWith(".html")) return "html";
  if (name.endsWith(".css")) return "css";
  if (name.endsWith(".js")) return "javascript";
  return "html";
}

/** Result of attempting to read one file from the server. */
export interface FileReadResult {
  content: string | null;
  exists: boolean;
}

/** Result of loading all files from the server. */
export interface LoadResult {
  /** "ok" = server responded for every file (some may be missing). "error" = hard load failure. */
  status: "ok" | "error";
  error?: string;
  /** Files that exist on the server (may be empty-content). Only set when status="ok". */
  files: HtmlFile[];
  /** True if at least one file exists on the server. Only set when status="ok". */
  anyExists: boolean;
}

/** Result of reconciling server load with local cache. */
export interface ReconcileResult {
  /** "server" = use server files. "seed" = seed server from template. "recovery" = local cache exists, server empty — explicit decision needed. "fresh" = no cache, server empty — seed from template. */
  action: "server" | "seed" | "recovery" | "fresh";
  files: HtmlFile[];
}

/**
 * Fetch a file from the server workspace.
 * - 404 → { content: null, exists: false } (file not found)
 * - 2xx → { content: string, exists: true } (file exists, content may be "")
 * - 500/401/403/network → throws Error (hard load failure)
 */
export async function fetchServerFile(
  fetchImpl: typeof fetch,
  projectId: string,
  fileName: string,
): Promise<FileReadResult> {
  let res: Response;
  try {
    res = await fetchImpl(`/api/studio-projects/${projectId}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read", path: fileName }),
    });
  } catch (err) {
    // Network error — hard failure, not "file not found"
    throw new Error(
      `Network error reading ${fileName}: ${err instanceof Error ? err.message : "unknown"}`,
    );
  }

  if (res.status === 404) {
    return { content: null, exists: false };
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      `HTTP ${res.status} reading ${fileName}: ${err.error ?? "server error"}`,
    );
  }

  const data = await res.json();
  // content can be "" (empty file) — that is a valid canonical file
  const content = typeof data.content === "string" ? data.content : null;
  return { content, exists: content !== null };
}

/**
 * Write a file to the server workspace.
 * Throws on any non-2xx response.
 */
export async function writeServerFile(
  fetchImpl: typeof fetch,
  projectId: string,
  fileName: string,
  content: string,
): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl(`/api/studio-projects/${projectId}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "write", path: fileName, content }),
    });
  } catch (err) {
    throw new Error(
      `Network error writing ${fileName}: ${err instanceof Error ? err.message : "unknown"}`,
    );
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      `HTTP ${res.status} writing ${fileName}: ${err.error ?? "server error"}`,
    );
  }
}

/**
 * Load all canonical HTML files from the server.
 * Uses Promise.all — any hard read error (500/401/403/network) aborts
 * the entire load. 404 is NOT a hard error; it means the file is missing.
 */
export async function loadServerFiles(
  fetchImpl: typeof fetch,
  projectId: string,
): Promise<LoadResult> {
  try {
    // Promise.all — if any read throws (500/401/403/network), the whole load fails.
    // 404 does NOT throw — it returns { exists: false }.
    const results = await Promise.all(
      HTML_FILES.map((fileName) => fetchServerFile(fetchImpl, projectId, fileName)),
    );

    const files: HtmlFile[] = [];
    let anyExists = false;
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.exists) {
        anyExists = true;
        files.push({
          name: HTML_FILES[i],
          language: languageForFile(HTML_FILES[i]),
          content: result.content ?? "",
        });
      }
    }

    return { status: "ok", files, anyExists };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : "Failed to load files",
      files: [],
      anyExists: false,
    };
  }
}

/**
 * Reconcile a server load result with local cache state.
 *
 * - Server has files → use server (canonical wins)
 * - Server empty, no local cache → seed from fresh template
 * - Server empty, local cache exists → "recovery" — explicit decision needed,
 *   NOT silent authority. The caller (hook/UI) must ask the user or apply
 *   an explicit policy.
 * - Load failed → caller handles error (this function is only called on status="ok")
 */
export function reconcileLoad(
  loadResult: LoadResult,
  localCache: HtmlProject | null,
  freshTemplate: HtmlProject,
): ReconcileResult {
  if (loadResult.status === "error") {
    // Should not reach here — caller handles errors before reconciling
    return { action: "fresh", files: freshTemplate.files };
  }

  if (loadResult.anyExists) {
    // Server has files — canonical wins
    return { action: "server", files: loadResult.files };
  }

  // Server is empty
  if (localCache) {
    // Local cache exists but server is empty — explicit recovery decision.
    // Do NOT silently treat local cache as canonical.
    return { action: "recovery", files: localCache.files };
  }

  // No local cache, server empty — seed from fresh template
  return { action: "seed", files: freshTemplate.files };
}

/**
 * Save all HTML files to the server.
 * Uses Promise.all — any non-2xx write throws and aborts the save.
 * Only returns successfully if every file returned 2xx.
 */
export async function saveServerFiles(
  fetchImpl: typeof fetch,
  projectId: string,
  files: HtmlFile[],
): Promise<void> {
  await Promise.all(
    files.map((f) => writeServerFile(fetchImpl, projectId, f.name, f.content)),
  );
}

/**
 * Read per-project localStorage cache.
 * Returns null if cache is missing or invalid.
 */
export function readLocalCache(projectId: string): HtmlProject | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + projectId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HtmlProject>;
    if (!parsed.files || !Array.isArray(parsed.files) || parsed.files.length === 0) {
      return null;
    }
    return {
      files: parsed.files
        .filter(
          (f) => f && typeof f.name === "string" && typeof f.content === "string",
        )
        .map((f) => ({
          name: f.name,
          content: f.content,
          // Ensure language is present — old cache entries may not have it
          language: (f.language ?? languageForFile(f.name)) as HtmlFileLanguage,
        })),
      activeFile:
        typeof parsed.activeFile === "string"
          ? parsed.activeFile
          : parsed.files[0]?.name ?? "index.html",
    };
  } catch {
    return null;
  }
}

/**
 * Write per-project localStorage cache.
 */
export function writeLocalCache(projectId: string, project: HtmlProject): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CACHE_KEY_PREFIX + projectId, JSON.stringify(project));
  } catch {
    // Cache write failed — non-fatal
  }
}
