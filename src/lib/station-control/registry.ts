/**
 * Station Control — Action Registry
 *
 * The registry is the single source of truth for all station actions.
 * Both the UI and LiTT call the exact same registry.
 */

import type { StationAction, StationId } from "./types";

export const STATION_ACTIONS: Record<string, StationAction<any, any>> = {};

export function registerStationAction(action: StationAction<any, any>): void {
  STATION_ACTIONS[action.id] = action;
}

export function getStationAction(id: string): StationAction<any, any> | null {
  return STATION_ACTIONS[id] ?? null;
}

export function getActionsForStation(station: StationId): StationAction<any, any>[] {
  return Object.values(STATION_ACTIONS).filter((a) => a.station === station);
}