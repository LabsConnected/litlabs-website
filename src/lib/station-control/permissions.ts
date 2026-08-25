/**
 * Station Control — Permissions
 *
 * Permission system for station actions. Each station has its own permission
 * level that controls whether mutations are allowed, require approval, or
 * are denied.
 */

import type { PermissionLevel, PermissionSet, StationId } from "./types";

export const DEFAULT_PERMISSIONS: PermissionSet = {
  files: "allow",
  terminal: "allow",
  browser: "allow",
  git: "allow",
  create: "allow",
  preview: "allow",
  deploy: "ask",
  production: "ask",
  payments: "ask",
  externalPost: "ask",
  secrets: "deny",
};

export function stationToPermissionKey(station: StationId): keyof PermissionSet {
  const map: Record<StationId, keyof PermissionSet> = {
    plan: "files",
    canvas: "files",
    code: "files",
    files: "files",
    preview: "preview",
    browser: "browser",
    terminal: "terminal",
    image: "create",
    video: "create",
    music: "create",
    audio: "create",
    design: "create",
    game: "create",
    environment: "create",
    git: "git",
    deploy: "deploy",
    checks: "files",
    assets: "files",
    memory: "files",
    voice: "files",
    camera: "files",
  };
  return map[station];
}

export function canMutate(permissions: PermissionSet, station: StationId): boolean {
  const level = permissions[stationToPermissionKey(station)];
  return level === "allow";
}

export function requiresApproval(permissions: PermissionSet, station: StationId): boolean {
  const level = permissions[stationToPermissionKey(station)];
  return level === "ask";
}