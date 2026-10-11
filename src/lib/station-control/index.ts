/**
 * Station Control Bridge — public entry (server-only).
 *
 * Chunk layout: chunk A (this chunk) owns the registry core. Chunks B/C own
 * the per-station action modules under ./stations/ and import them here for
 * side-effect registration. Explicit registration only — importing this
 * module registers actions but does NOT advertise them; the agent loop
 * (chunk E) calls registerAllStationActions() when it is ready.
 */
import "server-only";

// Station action modules (chunks B/C). Side-effect: registerStationAction().
// NOTE: these files are created in parallel by chunks B/C — missing files
// at test/build time are expected until those chunks land.
import "./stations/code";
import "./stations/files";
import "./stations/git";
import "./stations/deploy";
import "./stations/checks";
import "./stations/terminal";
import "./stations/preview";
import "./stations/browser";
import "./stations/canvas";
import "./stations/image";
import "./stations/video";
import "./stations/music";
import "./stations/audio";
import "./stations/assets";

export * from "./types";
export * from "./registry";
export * from "./permissions";
export * from "./executor";
export * from "./project-session";
export * from "./advertise";
export { delegateToTool } from "./delegate";

import { syncStationActionsToToolRegistry } from "./advertise";

/**
 * Register every station action into the LiTT tool registry so the agent
 * loop can advertise them to the model. Idempotent — safe to call twice.
 */
export function registerAllStationActions(): void {
  syncStationActionsToToolRegistry();
}
