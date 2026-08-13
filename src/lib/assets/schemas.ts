/**
 * Asset Lake — Zod schemas for runtime validation.
 *
 * The repo uses Zod heavily. These schemas validate that data returned
 * by adapters conforms to the StudioAsset contract before it reaches
 * the UI. Optional fields that are absent are left undefined — no
 * fabrication.
 */

import { z } from "zod";

export const AssetKindSchema = z.enum([
  "image",
  "video",
  "music",
  "audio",
  "design",
  "code",
  "game",
]);

export const AssetSourceSchema = z.enum([
  "generated",
  "uploaded",
  "imported",
]);

export const AssetVisibilitySchema = z.enum([
  "private",
  "unlisted",
  "public",
]);

export const StudioAssetSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().nullable().optional(),

  kind: AssetKindSchema,
  source: AssetSourceSchema,

  name: z.string(),
  url: z.string().url(),

  thumbnailUrl: z.string().url().optional(),
  previewUrl: z.string().url().optional(),

  mimeType: z.string().optional(),

  provider: z.string().optional(),
  model: z.string().optional(),
  prompt: z.string().optional(),
  promptHash: z.string().optional(),

  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSeconds: z.number().positive().optional(),

  costCredits: z.number().nonnegative().optional(),

  createdAt: z.string(),
  updatedAt: z.string().optional(),

  parentAssetIds: z.array(z.string()).optional(),
  version: z.number().int().nonnegative().optional(),

  visibility: AssetVisibilitySchema,

  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type StudioAssetParsed = z.infer<typeof StudioAssetSchema>;
