/**
 * Station Control Bridge — action registry (server-only).
 *
 * Single source of truth for all station actions. Contract:
 * docs/LITT-OS-IMPLEMENTATION-CONTRACT.md §3.2.
 */
import "server-only";
import type { StationAction, StationId } from "./types";

const STATION_ACTIONS = new Map<string, StationAction>();

/**
 * Register a station action. Throws on:
 * - duplicate id (the existing registration wins; the new one is rejected)
 * - id/station mismatch: the action id must be namespaced as
 *   "<station>.<name>" (e.g. "image.setPrompt") so registry lookups and
 *   permission routing stay consistent.
 */
export function registerStationAction(action: StationAction): void {
  if (!action || typeof action.id !== "string" || action.id.length === 0) {
    throw new Error("registerStationAction: action must have a non-empty string id");
  }
  const expectedPrefix = `${action.station}.`;
  if (!action.id.startsWith(expectedPrefix)) {
    throw new Error(
      `registerStationAction: id/station mismatch — action id "${action.id}" does not start with station prefix "${expectedPrefix}"`,
    );
  }
  const existing = STATION_ACTIONS.get(action.id);
  if (existing) {
    throw new Error(
      `registerStationAction: duplicate action id "${action.id}" (station "${action.station}")`,
    );
  }
  STATION_ACTIONS.set(action.id, action);
}

/** Get a station action by id. Returns undefined when not registered. */
export function getStationAction(id: string): StationAction | undefined {
  return STATION_ACTIONS.get(id);
}

/** All registered actions for one station, in registration order. */
export function getActionsForStation(station: StationId): StationAction[] {
  return Array.from(STATION_ACTIONS.values()).filter((a) => a.station === station);
}

/** All registered actions, in registration order. */
export function listStationActions(): StationAction[] {
  return Array.from(STATION_ACTIONS.values());
}
