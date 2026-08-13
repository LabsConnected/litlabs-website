/**
 * Asset Lake — canonical ID utilities.
 *
 * Assets from different legacy tables may produce the same raw UUID.
 * We qualify every canonical ID with a source prefix to prevent
 * cross-source ambiguity. Parsing helpers live here so string-prefix
 * logic is not scattered around UI code.
 */

import type { AssetSourcePrefix } from "./types";
import { ASSET_SOURCE_PREFIXES } from "./types";

/** Build a canonical asset ID from a source prefix + raw UUID. */
export function buildCanonicalId(
  prefix: AssetSourcePrefix,
  rawId: string,
): string {
  return `${prefix}:${rawId}`;
}

/** Parsed canonical ID — prefix + raw UUID. */
export interface ParsedAssetId {
  prefix: AssetSourcePrefix;
  rawId: string;
}

/**
 * Parse a canonical asset ID into its source prefix + raw UUID.
 * Returns null if the format is invalid or the prefix is unknown.
 */
export function parseCanonicalId(id: string): ParsedAssetId | null {
  const colonIndex = id.indexOf(":");
  if (colonIndex <= 0) return null;
  const prefix = id.slice(0, colonIndex);
  const rawId = id.slice(colonIndex + 1);
  if (!rawId) return null;
  if (
    !(ASSET_SOURCE_PREFIXES as readonly string[]).includes(prefix)
  ) {
    return null;
  }
  return { prefix: prefix as AssetSourcePrefix, rawId };
}

/** Check whether a string is a valid canonical asset ID. */
export function isCanonicalAssetId(id: string): boolean {
  return parseCanonicalId(id) !== null;
}

/** Extract the source prefix from a canonical asset ID. */
export function getAssetSourcePrefix(id: string): AssetSourcePrefix | null {
  return parseCanonicalId(id)?.prefix ?? null;
}
