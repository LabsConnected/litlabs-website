/**
 * Station action id → canonical tool-registry id for delegate-mirrored
 * advertisements. Station modules call setDelegateToolId when a station
 * action delegates to an existing canonical tool; the advertisement then
 * mirrors the delegate's capabilities, risk, permission level, approval
 * policy, and timeout — and the permission engine resolves the canonical
 * id so an alias can never carry a different privilege than the tool it
 * actually executes.
 *
 * Leaf module with zero imports on purpose: both the station-control
 * advertisement layer (which populates the map) and the permission
 * engine (which reads it) depend on it — keeping it dependency-free is
 * what lets the engine resolve delegates without an import cycle back
 * into station-control.
 */
const DELEGATE_TOOL_IDS = new Map<string, string>();

export function setDelegateToolId(stationActionId: string, toolId: string): void {
  DELEGATE_TOOL_IDS.set(stationActionId, toolId);
}

export function getDelegateToolId(stationActionId: string): string | undefined {
  return DELEGATE_TOOL_IDS.get(stationActionId);
}
