/**
 * V8 module compile cache — must be the FIRST module evaluated so
 * every subsequent import (including the heavy lazy Ink cockpit chain)
 * can reuse compiled bytecode across launches.
 *
 * Node 22.8+ persists compiled code to a cache dir (~/.cache/node or
 * NODE_COMPILE_CACHE). First launch pays the compile; warm launches
 * skip re-parse/re-compile of unchanged modules — the dominant startup
 * cost for this CLI (hundreds of ms across the command + Ink graph).
 *
 * Best-effort: any failure (old Node, read-only cache dir) is ignored —
 * correctness never depends on the cache existing.
 */

import { enableCompileCache } from "node:module";

try {
  enableCompileCache?.();
} catch {
  /* non-fatal */
}
