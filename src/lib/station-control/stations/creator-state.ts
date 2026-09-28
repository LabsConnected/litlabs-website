/**
 * Station Control Bridge — creator station params store (chunk C, server-only).
 *
 * Tiny in-memory store for the creator stations (image / video / music /
 * audio). The ImageTool/VideoTool UIs keep these params in component state;
 * the station actions need the same staging area so a conversation can set
 * params across turns (image.setPrompt → image.setStyle → image.generate)
 * before invoking a generation.
 *
 * Keyed by `${conversationId}:${projectId}` so parallel conversations do not
 * clobber each other. In-memory only — a VM replacement loses the staging
 * params; generations already saved to the project are durable.
 */
import "server-only";

import type { StationExecutionContext } from "../types";

export interface CreatorResultRef {
  id: string;
  url: string;
  kind: "image" | "video" | "music" | "audio";
  /** Stable project asset path once the result has been saved into the project. */
  sitePath?: string;
}

export interface CreatorParams {
  prompt?: string;
  negativePrompt?: string;
  style?: string;
  aspectRatio?: string;
  referenceAssetId?: string;
  /** Last selected result id (via image.selectResult) for save/send-to-canvas. */
  selectedResultId?: string;
  videoModel?: string;
  videoDurationSec?: number;
  musicStyle?: string;
  musicLyrics?: string;
  musicBpm?: number;
  lastResults: CreatorResultRef[];
}

const store = new Map<string, CreatorParams>();

/** Registry key for a station execution context. */
export function creatorKey(ctx: StationExecutionContext): string {
  const conversation = ctx.conversationId ?? "default";
  const project = ctx.projectId ?? "default";
  return `${conversation}:${project}`;
}

function fresh(): CreatorParams {
  return { lastResults: [] };
}

export function getCreatorParams(key: string): CreatorParams {
  const existing = store.get(key);
  if (existing) return existing;
  const next = fresh();
  store.set(key, next);
  return next;
}

export function setCreatorParams(
  key: string,
  partial: Partial<Omit<CreatorParams, "lastResults">> & { lastResults?: CreatorResultRef[] },
): CreatorParams {
  const current = getCreatorParams(key);
  const merged: CreatorParams = { ...current, ...partial };
  store.set(key, merged);
  return merged;
}

/** Append a generation result to the session's result history (bounded). */
export function pushCreatorResult(
  key: string,
  ref: CreatorResultRef,
): CreatorParams {
  const current = getCreatorParams(key);
  const lastResults = [...current.lastResults, ref].slice(-25);
  const merged: CreatorParams = { ...current, lastResults };
  store.set(key, merged);
  return merged;
}

/** Test/housekeeping hook: drop staged params for a key. */
export function clearCreatorParams(key: string): void {
  store.delete(key);
}
