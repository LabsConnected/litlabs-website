import { z } from "zod";

export const visualBuildStatuses = [
  "queued",
  "planning_visuals",
  "searching_project_assets",
  "searching_stock_assets",
  "generating_assets",
  "validating_assets",
  "saving_assets",
  "building",
  "rendering",
  "capturing",
  "reviewing",
  "awaiting_approval",
  "repairing",
  "complete",
  "partial",
  "failed",
] as const;

export type VisualBuildStatus = (typeof visualBuildStatuses)[number];

export const visualReviewFindings = [
  "broken_asset",
  "overflow",
  "responsive",
  "contrast",
  "typography",
  "spacing",
  "alignment",
  "composition",
  "generic_design",
  "brand_mismatch",
] as const;

export type VisualReviewFindingCategory = (typeof visualReviewFindings)[number];
export type VisualSourceType = "project" | "stock" | "generated" | "uploaded";
export type VisualQualityLevel = "draft" | "polished" | "cinematic";
export type VisualMockupMode = "off" | "browser" | "mobile" | "multi-device";
export type AssetQuality = "usable" | "weak" | "invalid";
export type PreviewViewport = "desktop" | "tablet" | "mobile";

export interface VisualBuildBudget {
  maxStockSearches: number;
  maxGeneratedAssets: number;
  maxImageGenerationCostCents: number;
  maxVisionReviews: number;
  maxRepairPasses: number;
  timeoutSeconds: number;
}

export const VisualBuildBudgetSchema = z.object({
  maxStockSearches: z.number().int().min(0),
  maxGeneratedAssets: z.number().int().min(0),
  maxImageGenerationCostCents: z.number().int().min(0),
  maxVisionReviews: z.number().int().min(0),
  maxRepairPasses: z.number().int().min(0),
  timeoutSeconds: z.number().int().min(1),
});

export interface VisualPlanSection {
  id: string;
  key: string;
  title: string;
  required: boolean;
  requiredAssetType: string;
  aspectRatio: string;
  sourcePreference: VisualSourceType[];
  fallbackStrategy: string;
  copy?: string | null;
}

export const VisualPlanSectionSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  title: z.string().min(1),
  required: z.boolean(),
  requiredAssetType: z.string().min(1),
  aspectRatio: z.string().min(1),
  sourcePreference: z.array(z.enum(["project", "stock", "generated", "uploaded"])),
  fallbackStrategy: z.string().min(1),
  copy: z.string().nullable().optional(),
});

export interface VisualPlan {
  id: string;
  projectId: string;
  missionId: string;
  workspaceId: string;
  product: string;
  audience: string;
  visualDirection: string;
  brandColors: string[];
  typographyDirection: string;
  densityAndLayoutDirection: string;
  sectionRequirements: VisualPlanSection[];
  qualityLevel: VisualQualityLevel;
  mockupMode: VisualMockupMode;
  responsiveTargets: PreviewViewport[];
  request: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export const VisualPlanSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  missionId: z.string().min(1),
  workspaceId: z.string().min(1),
  product: z.string().min(1),
  audience: z.string().min(1),
  visualDirection: z.string().min(1),
  brandColors: z.array(z.string().min(1)),
  typographyDirection: z.string().min(1),
  densityAndLayoutDirection: z.string().min(1),
  sectionRequirements: z.array(VisualPlanSectionSchema),
  qualityLevel: z.enum(["draft", "polished", "cinematic"]),
  mockupMode: z.enum(["off", "browser", "mobile", "multi-device"]),
  responsiveTargets: z.array(z.enum(["desktop", "tablet", "mobile"])),
  request: z.record(z.string(), z.unknown()),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export interface AssetInspection {
  reachable: boolean;
  statusCode: number;
  contentType: string;
  width: number | null;
  height: number | null;
  bytes: number;
  aspectRatio: number | null;
  hasAlpha: boolean | null;
  animated: boolean;
  checksum: string;
  quality: AssetQuality;
  rejectionReasons: string[];
}

export const AssetInspectionSchema = z.object({
  reachable: z.boolean(),
  statusCode: z.number().int(),
  contentType: z.string().min(1),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  bytes: z.number().int().min(0),
  aspectRatio: z.number().nullable(),
  hasAlpha: z.boolean().nullable(),
  animated: z.boolean(),
  checksum: z.string().min(1),
  quality: z.enum(["usable", "weak", "invalid"]),
  rejectionReasons: z.array(z.string()),
});

export interface ProjectAsset {
  id: string;
  projectId: string;
  missionId: string;
  buildId: string;
  sourceType: VisualSourceType;
  provider: string;
  originalUrl: string | null;
  storedUrl: string;
  attribution: string | null;
  license: string | null;
  prompt: string | null;
  query: string | null;
  sectionKey: string | null;
  width: number | null;
  height: number | null;
  bytes: number;
  checksum: string;
  contentType: string;
  inspection: AssetInspection;
  selected: boolean;
  rejected: boolean;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export const ProjectAssetSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  missionId: z.string().min(1),
  buildId: z.string().min(1),
  sourceType: z.enum(["project", "stock", "generated", "uploaded"]),
  provider: z.string().min(1),
  originalUrl: z.string().nullable(),
  storedUrl: z.string().min(1),
  attribution: z.string().nullable(),
  license: z.string().nullable(),
  prompt: z.string().nullable(),
  query: z.string().nullable(),
  sectionKey: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  bytes: z.number().int().min(0),
  checksum: z.string().min(1),
  contentType: z.string().min(1),
  inspection: AssetInspectionSchema,
  selected: z.boolean(),
  rejected: z.boolean(),
  rejectionReason: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export interface AssetManifest {
  id: string;
  projectId: string;
  missionId: string;
  buildId: string;
  assets: ProjectAsset[];
  selectedCount: number;
  rejectedCount: number;
  createdAt: string;
  updatedAt: string;
}

export const AssetManifestSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  missionId: z.string().min(1),
  buildId: z.string().min(1),
  assets: z.array(ProjectAssetSchema),
  selectedCount: z.number().int().min(0),
  rejectedCount: z.number().int().min(0),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export interface VisualBuild {
  id: string;
  projectId: string;
  missionId: string;
  workspaceId: string;
  status: VisualBuildStatus;
  visualPlanId: string | null;
  assetManifestId: string | null;
  previewId: string | null;
  repairPass: number;
  budget: VisualBuildBudget;
  request: Record<string, unknown>;
  summary: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export const VisualBuildSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  missionId: z.string().min(1),
  workspaceId: z.string().min(1),
  status: z.enum(visualBuildStatuses),
  visualPlanId: z.string().nullable(),
  assetManifestId: z.string().nullable(),
  previewId: z.string().nullable(),
  repairPass: z.number().int().min(0),
  budget: VisualBuildBudgetSchema,
  request: z.record(z.string(), z.unknown()),
  summary: z.record(z.string(), z.unknown()),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export interface VisualReviewFinding {
  category: VisualReviewFindingCategory;
  severity: "critical" | "high" | "medium" | "low";
  viewport: PreviewViewport;
  selector?: string;
  evidence: string;
  repairInstruction: string;
}

export const VisualReviewFindingSchema = z.object({
  category: z.enum(visualReviewFindings),
  severity: z.enum(["critical", "high", "medium", "low"]),
  viewport: z.enum(["desktop", "tablet", "mobile"]),
  selector: z.string().optional(),
  evidence: z.string().min(1),
  repairInstruction: z.string().min(1),
});

export interface VisualReview {
  score: number;
  verdict: "pass" | "repair" | "fail";
  findings: VisualReviewFinding[];
}

export const VisualReviewSchema = z.object({
  score: z.number().min(0).max(100),
  verdict: z.enum(["pass", "repair", "fail"]),
  findings: z.array(VisualReviewFindingSchema),
});

export interface PreviewCapture {
  id: string;
  projectId: string;
  missionId: string;
  buildId: string;
  viewport: PreviewViewport;
  width: number;
  height: number;
  screenshotUrl: string | null;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  horizontalOverflow: boolean;
  documentWidth: number | null;
  viewportWidth: number | null;
  brokenImages: number;
  missingFonts: number;
  layoutShifts: Array<{ value: number; hadRecentInput: boolean }>;
  createdAt: string;
  updatedAt: string;
}

export const PreviewCaptureSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  missionId: z.string().min(1),
  buildId: z.string().min(1),
  viewport: z.enum(["desktop", "tablet", "mobile"]),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  screenshotUrl: z.string().nullable(),
  consoleErrors: z.array(z.string()),
  pageErrors: z.array(z.string()),
  failedRequests: z.array(z.string()),
  horizontalOverflow: z.boolean(),
  documentWidth: z.number().int().nullable(),
  viewportWidth: z.number().int().nullable(),
  brokenImages: z.number().int().min(0),
  missingFonts: z.number().int().min(0),
  layoutShifts: z.array(z.object({ value: z.number(), hadRecentInput: z.boolean() })),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const VisualBuildRequestSchema = z.object({
  missionId: z.string().min(1).optional(),
  prompt: z.string().min(3),
  product: z.string().min(1).optional(),
  audience: z.string().min(1).optional(),
  visualSource: z.enum(["auto", "real-photos", "ai-generated", "project-assets"]).default("auto"),
  quality: z.enum(["draft", "polished", "cinematic"]).default("polished"),
  artDirection: z.enum(["auto", "minimal", "neon", "editorial", "custom"]).default("auto"),
  imageSource: z.enum(["auto", "stock", "generated", "uploaded"]).default("auto"),
  mockups: z.enum(["off", "browser", "mobile", "multi-device"]).default("browser"),
  review: z.boolean().default(true),
  responsiveQA: z.boolean().default(true),
  budget: VisualBuildBudgetSchema.optional(),
});

export type VisualBuildRequest = z.infer<typeof VisualBuildRequestSchema>;

export const defaultVisualBuildBudget = (quality: VisualQualityLevel): VisualBuildBudget => {
  if (quality === "draft") {
    return {
      maxStockSearches: 1,
      maxGeneratedAssets: 1,
      maxImageGenerationCostCents: 0,
      maxVisionReviews: 1,
      maxRepairPasses: 1,
      timeoutSeconds: 120,
    };
  }
  if (quality === "cinematic") {
    return {
      maxStockSearches: 8,
      maxGeneratedAssets: 8,
      maxImageGenerationCostCents: 800,
      maxVisionReviews: 2,
      maxRepairPasses: 3,
      timeoutSeconds: 600,
    };
  }
  return {
    maxStockSearches: 4,
    maxGeneratedAssets: 4,
    maxImageGenerationCostCents: 400,
    maxVisionReviews: 1,
    maxRepairPasses: 2,
    timeoutSeconds: 300,
  };
};
