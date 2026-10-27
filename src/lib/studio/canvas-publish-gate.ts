/**
 * Server-side publish gate for the canvas↔file unification.
 *
 * Reads .litt/canvas.json + index.html through the workspace transport,
 * classifies the pair, and decides whether publishing is allowed. Used by
 * the publish route (block) and the canvas apply route (decision input).
 * Fail-closed: an unreadable canvas state blocks publish rather than
 * silently shipping divergent content.
 */

import type { WorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";
import {
  CANVAS_DOC_PATH,
  ENTRY_FILE_PATH,
  classifyCanvasState,
  stateBlocksPublish,
  type CanvasClassifyResult,
} from "./canvas-ssot";

/** Read a text file; null when absent. Any other error propagates. */
export async function readWorkspaceTextIfExists(
  transport: WorkspaceTransport,
  path: string,
): Promise<string | null> {
  try {
    return (await transport.readFile(path)).content;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/\b404\b|not found|ENOENT/i.test(msg)) return null;
    throw err;
  }
}

export interface CanvasGateVerdict {
  state: CanvasClassifyResult["state"] | "unavailable";
  blocked: boolean;
  detail: string;
  classification: CanvasClassifyResult | null;
}

export async function evaluateCanvasGate(
  transport: WorkspaceTransport,
): Promise<CanvasGateVerdict> {
  let classification: CanvasClassifyResult;
  try {
    const [canvasRaw, indexRaw] = await Promise.all([
      readWorkspaceTextIfExists(transport, CANVAS_DOC_PATH),
      readWorkspaceTextIfExists(transport, ENTRY_FILE_PATH),
    ]);
    classification = await classifyCanvasState({ canvasRaw, indexRaw });
  } catch (err) {
    // Couldn't even read the files — cannot prove the site reflects the
    // canvas. Fail closed.
    return {
      state: "unavailable",
      blocked: true,
      detail: err instanceof Error ? err.message : "workspace read failed",
      classification: null,
    };
  }
  return {
    state: classification.state,
    blocked: stateBlocksPublish(classification.state),
    detail: classification.detail,
    classification,
  };
}
