/**
 * Asset Lake — public API barrel.
 *
 * Re-exports the canonical types, schemas, ID utilities, and repository
 * for consumers. Adapters are internal — callers use the repository.
 */

export type {
  AssetKind,
  AssetSource,
  AssetVisibility,
  StudioAsset,
  AssetSourcePrefix,
} from "./types";

export { ASSET_KINDS, isAssetKind } from "./types";

export {
  buildCanonicalId,
  parseCanonicalId,
  isCanonicalAssetId,
  getAssetSourcePrefix,
} from "./ids";

export type { ParsedAssetId } from "./ids";

export {
  AssetKindSchema,
  AssetSourceSchema,
  AssetVisibilitySchema,
  StudioAssetSchema,
} from "./schemas";

export type { StudioAssetParsed } from "./schemas";

export {
  listStudioAssets,
  getStudioAsset,
} from "./repository";

export type { ListStudioAssetsOptions } from "./repository";
