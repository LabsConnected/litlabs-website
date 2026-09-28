/**
 * Station Control Bridge — agent-loop event sink (server-only, chunk E).
 *
 * Routes station ExecutionEvents into the agent run's Activity stream
 * (localProgress). The sink is keyed by the run's WorkspaceTransport
 * instance — NOT a module-global single sink — so two agent runs
 * interleaving in one process cannot cross-wire events into each other's
 * Activity streams.
 *
 * Wiring:
 * - agent-loop-v2.ts sets the sink when a run starts and clears it in a
 *   finally when the run ends (both runAgentLoopV2 and resumeAgentLoopV2).
 * - advertise.ts's registry handler looks the sink up by the transport it
 *   was invoked with and, when set, builds the station context with an
 *   emitEvent that forwards through the sink. When unset (standalone or
 *   UI callers), the default console-log emitEvent applies.
 *
 * Uses chunk A's StationExecutionContext/ExecutionEvent from
 * @/lib/station-control/types. Never imports chunk D's UI-side
 * station-context.ts.
 */
import "server-only";
import type { ExecutionEvent, StationId } from "./types";

/** The emitEvent shape chunk A defines (id/seq/ts are assigned downstream). */
export type StationEventSink = (event: Omit<ExecutionEvent, "id" | "seq" | "ts">) => void;

const sinks = new WeakMap<object, StationEventSink>();

/**
 * Register (or clear, with null) the event sink for one run's transport.
 * Safe to call with a non-object transport — it becomes a no-op rather
 * than throwing inside the agent loop.
 */
export function setStationEventSink(transport: unknown, sink: StationEventSink | null): void {
  if (typeof transport !== "object" || transport === null) return;
  if (sink) sinks.set(transport, sink);
  else sinks.delete(transport);
}

/** Look up the sink for a transport. Returns null when the loop did not set one. */
export function getStationEventSink(transport: unknown): StationEventSink | null {
  if (typeof transport !== "object" || transport === null) return null;
  return sinks.get(transport) ?? null;
}

const STATION_ACTIVITY_LABELS: Record<StationId, string> = {
  plan: "Planning",
  canvas: "Updating canvas",
  code: "Editing code",
  files: "Editing files",
  preview: "Capturing preview",
  browser: "Browsing",
  terminal: "Running terminal",
  image: "Creating image",
  video: "Creating video",
  music: "Creating music",
  audio: "Generating audio",
  design: "Designing",
  game: "Building game",
  environment: "Setting up environment",
  git: "Running git",
  deploy: "Deploying",
  checks: "Running checks",
  assets: "Managing assets",
  memory: "Updating memory",
  voice: "Working with voice",
  camera: "Using camera",
};

/**
 * Human-readable Activity summary for a station execution event.
 * Never throws — unknown stations degrade to a generic label.
 */
export function summarizeStationEvent(event: Omit<ExecutionEvent, "id" | "seq" | "ts">): string {
  const label = STATION_ACTIVITY_LABELS[event.station] ?? "Working";
  switch (event.type) {
    case "action_started":
      return `${label}…`;
    case "action_completed":
      return `${label} — done`;
    case "action_failed":
      return event.error ? `${label} — failed: ${event.error}` : `${label} — failed`;
    case "approval_required":
      return "Waiting for approval";
    case "live_state":
      return "Live update";
  }
}
