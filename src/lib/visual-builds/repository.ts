import { supabaseAdmin } from "@/lib/supabase";
import {
  AssetManifestSchema,
  ProjectAssetSchema,
  PreviewCaptureSchema,
  VisualBuildBudgetSchema,
  VisualBuildSchema,
  VisualPlanSchema,
  VisualReviewSchema,
  type AssetInspection,
  type AssetManifest,
  type PreviewCapture,
  type ProjectAsset,
  type VisualBuild,
  type VisualBuildBudget,
  type VisualPlan,
  type VisualReview,
} from "./types";

interface VisualBuildRow {
  id: string;
  project_id: string;
  mission_id: string;
  workspace_id: string;
  user_id: string;
  status: VisualBuild["status"];
  visual_plan_id: string | null;
  asset_manifest_id: string | null;
  preview_id: string | null;
  repair_pass: number;
  repair_limit: number;
  budget: Record<string, unknown>;
  request: Record<string, unknown>;
  summary: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface VisualPlanRow {
  id: string;
  project_id: string;
  mission_id: string;
  build_id: string;
  user_id: string;
  plan: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface VisualAssetManifestRow {
  id: string;
  project_id: string;
  mission_id: string;
  build_id: string;
  user_id: string;
  manifest: Record<string, unknown>;
  selected_count: number;
  rejected_count: number;
  created_at: string;
  updated_at: string;
}

interface ProjectAssetRow {
  id: string;
  project_id: string;
  mission_id: string;
  build_id: string;
  user_id: string;
  source_type: ProjectAsset["sourceType"];
  provider: string;
  original_url: string | null;
  stored_url: string;
  attribution: string | null;
  license: string | null;
  prompt: string | null;
  query: string | null;
  section_key: string | null;
  width: number | null;
  height: number | null;
  bytes: number;
  checksum: string;
  content_type: string;
  inspection: Record<string, unknown>;
  selected: boolean;
  rejected: boolean;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface PreviewCaptureRow {
  id: string;
  project_id: string;
  mission_id: string;
  build_id: string;
  user_id: string;
  viewport: PreviewCapture["viewport"];
  width: number;
  height: number;
  screenshot_url: string | null;
  console_errors: string[];
  page_errors: string[];
  failed_requests: string[];
  horizontal_overflow: boolean;
  document_width: number | null;
  viewport_width: number | null;
  broken_images: number;
  missing_fonts: number;
  layout_shifts: Array<{ value: number; hadRecentInput: boolean }>;
  created_at: string;
  updated_at: string;
}

interface VisualReviewRow {
  id: string;
  project_id: string;
  mission_id: string;
  build_id: string;
  user_id: string;
  score: number;
  verdict: VisualReview["verdict"];
  findings: VisualReview["findings"];
  created_at: string;
  updated_at: string;
}

function rowToBuild(row: VisualBuildRow): VisualBuild {
  return VisualBuildSchema.parse({
    id: row.id,
    projectId: row.project_id,
    missionId: row.mission_id,
    workspaceId: row.workspace_id,
    status: row.status,
    visualPlanId: row.visual_plan_id,
    assetManifestId: row.asset_manifest_id,
    previewId: row.preview_id,
    repairPass: row.repair_pass,
    budget: VisualBuildBudgetSchema.parse(row.budget),
    request: row.request,
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function rowToPlan(row: VisualPlanRow): VisualPlan {
  return VisualPlanSchema.parse({
    id: row.id,
    projectId: row.project_id,
    missionId: row.mission_id,
    workspaceId: String(row.plan.workspaceId ?? ""),
    product: String(row.plan.product ?? "Landing page"),
    audience: String(row.plan.audience ?? "Website visitors"),
    visualDirection: String(row.plan.visualDirection ?? "Branded, editorial, and conversion-focused"),
    brandColors: Array.isArray(row.plan.brandColors) ? row.plan.brandColors : [],
    typographyDirection: String(row.plan.typographyDirection ?? "Bold sans serif with clear hierarchy"),
    densityAndLayoutDirection: String(row.plan.densityAndLayoutDirection ?? "Balanced spacing with a single strong hero"),
    sectionRequirements: Array.isArray(row.plan.sectionRequirements) ? row.plan.sectionRequirements : [],
    qualityLevel: row.plan.qualityLevel ?? "polished",
    mockupMode: row.plan.mockupMode ?? "browser",
    responsiveTargets: Array.isArray(row.plan.responsiveTargets) ? row.plan.responsiveTargets : ["desktop", "mobile"],
    request: typeof row.plan.request === "object" && row.plan.request !== null ? (row.plan.request as Record<string, unknown>) : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function rowToManifest(row: VisualAssetManifestRow): AssetManifest {
  const assets = Array.isArray(row.manifest.assets) ? row.manifest.assets : [];
  return AssetManifestSchema.parse({
    id: row.id,
    projectId: row.project_id,
    missionId: row.mission_id,
    buildId: row.build_id,
    assets,
    selectedCount: row.selected_count,
    rejectedCount: row.rejected_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function rowToProjectAsset(row: ProjectAssetRow): ProjectAsset {
  return ProjectAssetSchema.parse({
    id: row.id,
    projectId: row.project_id,
    missionId: row.mission_id,
    buildId: row.build_id,
    sourceType: row.source_type,
    provider: row.provider,
    originalUrl: row.original_url,
    storedUrl: row.stored_url,
    attribution: row.attribution,
    license: row.license,
    prompt: row.prompt,
    query: row.query,
    sectionKey: row.section_key,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    checksum: row.checksum,
    contentType: row.content_type,
    inspection: row.inspection,
    selected: row.selected,
    rejected: row.rejected,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function rowToPreviewCapture(row: PreviewCaptureRow): PreviewCapture {
  return PreviewCaptureSchema.parse({
    id: row.id,
    projectId: row.project_id,
    missionId: row.mission_id,
    buildId: row.build_id,
    viewport: row.viewport,
    width: row.width,
    height: row.height,
    screenshotUrl: row.screenshot_url,
    consoleErrors: row.console_errors,
    pageErrors: row.page_errors,
    failedRequests: row.failed_requests,
    horizontalOverflow: row.horizontal_overflow,
    documentWidth: row.document_width,
    viewportWidth: row.viewport_width,
    brokenImages: row.broken_images,
    missingFonts: row.missing_fonts,
    layoutShifts: row.layout_shifts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function rowToReview(row: VisualReviewRow): VisualReview {
  return VisualReviewSchema.parse({
    score: row.score,
    verdict: row.verdict,
    findings: row.findings,
  });
}

export async function createVisualBuild(input: {
  projectId: string;
  missionId: string;
  workspaceId: string;
  userId: string;
  budget: VisualBuildBudget;
  request: Record<string, unknown>;
  status?: VisualBuild["status"];
  repairLimit?: number;
  summary?: Record<string, unknown>;
}): Promise<VisualBuild> {
  const { data, error } = await supabaseAdmin
    .from("visual_builds")
    .insert({
      project_id: input.projectId,
      mission_id: input.missionId,
      workspace_id: input.workspaceId,
      user_id: input.userId,
      status: input.status ?? "queued",
      repair_pass: 0,
      repair_limit: input.repairLimit ?? input.budget.maxRepairPasses,
      budget: input.budget,
      request: input.request,
      summary: input.summary ?? {},
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create visual build: ${error?.message ?? "unknown error"}`);
  }

  return rowToBuild(data as VisualBuildRow);
}

export async function updateVisualBuild(
  buildId: string,
  updates: Partial<{
    status: VisualBuild["status"];
    visualPlanId: string | null;
    assetManifestId: string | null;
    previewId: string | null;
    repairPass: number;
    summary: Record<string, unknown>;
    request: Record<string, unknown>;
    budget: VisualBuildBudget;
  }>,
): Promise<VisualBuild | null> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.status !== undefined) payload.status = updates.status;
  if (updates.visualPlanId !== undefined) payload.visual_plan_id = updates.visualPlanId;
  if (updates.assetManifestId !== undefined) payload.asset_manifest_id = updates.assetManifestId;
  if (updates.previewId !== undefined) payload.preview_id = updates.previewId;
  if (updates.repairPass !== undefined) payload.repair_pass = updates.repairPass;
  if (updates.summary !== undefined) payload.summary = updates.summary;
  if (updates.request !== undefined) payload.request = updates.request;
  if (updates.budget !== undefined) payload.budget = updates.budget;

  const { data } = await supabaseAdmin
    .from("visual_builds")
    .update(payload)
    .eq("id", buildId)
    .select()
    .maybeSingle();

  return data ? rowToBuild(data as VisualBuildRow) : null;
}

export async function getVisualBuild(buildId: string, projectId?: string): Promise<VisualBuild | null> {
  let query = supabaseAdmin.from("visual_builds").select("*").eq("id", buildId);
  if (projectId) {
    query = query.eq("project_id", projectId);
  }
  const { data } = await query.maybeSingle();
  return data ? rowToBuild(data as VisualBuildRow) : null;
}

export async function listVisualBuilds(projectId: string): Promise<VisualBuild[]> {
  const { data } = await supabaseAdmin
    .from("visual_builds")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  return (data ?? []).map((row) => rowToBuild(row as VisualBuildRow));
}

export async function createVisualPlan(input: {
  projectId: string;
  missionId: string;
  buildId: string;
  userId: string;
  plan: Record<string, unknown>;
}): Promise<VisualPlan> {
  const { data, error } = await supabaseAdmin
    .from("visual_plans")
    .insert({
      project_id: input.projectId,
      mission_id: input.missionId,
      build_id: input.buildId,
      user_id: input.userId,
      plan: input.plan,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create visual plan: ${error?.message ?? "unknown error"}`);
  }

  return rowToPlan(data as VisualPlanRow);
}

export async function updateVisualPlan(
  planId: string,
  plan: Record<string, unknown>,
): Promise<VisualPlan | null> {
  const { data } = await supabaseAdmin
    .from("visual_plans")
    .update({ plan, updated_at: new Date().toISOString() })
    .eq("id", planId)
    .select()
    .maybeSingle();
  return data ? rowToPlan(data as VisualPlanRow) : null;
}

export async function createAssetManifest(input: {
  projectId: string;
  missionId: string;
  buildId: string;
  userId: string;
  manifest: Record<string, unknown>;
  selectedCount: number;
  rejectedCount: number;
}): Promise<AssetManifest> {
  const { data, error } = await supabaseAdmin
    .from("visual_asset_manifests")
    .insert({
      project_id: input.projectId,
      mission_id: input.missionId,
      build_id: input.buildId,
      user_id: input.userId,
      manifest: input.manifest,
      selected_count: input.selectedCount,
      rejected_count: input.rejectedCount,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create asset manifest: ${error?.message ?? "unknown error"}`);
  }

  return rowToManifest(data as VisualAssetManifestRow);
}

export async function updateAssetManifest(
  manifestId: string,
  updates: {
    manifest?: Record<string, unknown>;
    selectedCount?: number;
    rejectedCount?: number;
  },
): Promise<AssetManifest | null> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.manifest !== undefined) payload.manifest = updates.manifest;
  if (updates.selectedCount !== undefined) payload.selected_count = updates.selectedCount;
  if (updates.rejectedCount !== undefined) payload.rejected_count = updates.rejectedCount;

  const { data } = await supabaseAdmin
    .from("visual_asset_manifests")
    .update(payload)
    .eq("id", manifestId)
    .select()
    .maybeSingle();

  return data ? rowToManifest(data as VisualAssetManifestRow) : null;
}

export async function createProjectAsset(input: {
  projectId: string;
  missionId: string;
  buildId: string;
  userId: string;
  sourceType: ProjectAsset["sourceType"];
  provider: string;
  originalUrl: string | null;
  storedUrl: string;
  attribution?: string | null;
  license?: string | null;
  prompt?: string | null;
  query?: string | null;
  sectionKey?: string | null;
  width?: number | null;
  height?: number | null;
  bytes: number;
  checksum: string;
  contentType: string;
  inspection: AssetInspection;
  selected?: boolean;
  rejected?: boolean;
  rejectionReason?: string | null;
}): Promise<ProjectAsset> {
  const existing = await supabaseAdmin
    .from("project_assets")
    .select("*")
    .eq("project_id", input.projectId)
    .eq("checksum", input.checksum)
    .maybeSingle();

  if (existing.data) {
    return rowToProjectAsset(existing.data as ProjectAssetRow);
  }

  const { data, error } = await supabaseAdmin
    .from("project_assets")
    .insert({
      project_id: input.projectId,
      mission_id: input.missionId,
      build_id: input.buildId,
      user_id: input.userId,
      source_type: input.sourceType,
      provider: input.provider,
      original_url: input.originalUrl,
      stored_url: input.storedUrl,
      attribution: input.attribution ?? null,
      license: input.license ?? null,
      prompt: input.prompt ?? null,
      query: input.query ?? null,
      section_key: input.sectionKey ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      bytes: input.bytes,
      checksum: input.checksum,
      content_type: input.contentType,
      inspection: input.inspection,
      selected: input.selected ?? false,
      rejected: input.rejected ?? false,
      rejection_reason: input.rejectionReason ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create project asset: ${error?.message ?? "unknown error"}`);
  }

  return rowToProjectAsset(data as ProjectAssetRow);
}

export async function updateProjectAsset(
  assetId: string,
  updates: Partial<{
    selected: boolean;
    rejected: boolean;
    rejectionReason: string | null;
    storedUrl: string;
    inspection: Record<string, unknown>;
  }>,
): Promise<ProjectAsset | null> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.selected !== undefined) payload.selected = updates.selected;
  if (updates.rejected !== undefined) payload.rejected = updates.rejected;
  if (updates.rejectionReason !== undefined) payload.rejection_reason = updates.rejectionReason;
  if (updates.storedUrl !== undefined) payload.stored_url = updates.storedUrl;
  if (updates.inspection !== undefined) payload.inspection = updates.inspection;

  const { data } = await supabaseAdmin
    .from("project_assets")
    .update(payload)
    .eq("id", assetId)
    .select()
    .maybeSingle();

  return data ? rowToProjectAsset(data as ProjectAssetRow) : null;
}

export async function listProjectAssets(projectId: string, opts?: { buildId?: string; sectionKey?: string; limit?: number }): Promise<ProjectAsset[]> {
  let query = supabaseAdmin.from("project_assets").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
  if (opts?.buildId) query = query.eq("build_id", opts.buildId);
  if (opts?.sectionKey) query = query.eq("section_key", opts.sectionKey);
  if (opts?.limit) query = query.limit(opts.limit);
  const { data } = await query;
  return (data ?? []).map((row) => rowToProjectAsset(row as ProjectAssetRow));
}

export async function getProjectAssetByChecksum(projectId: string, checksum: string): Promise<ProjectAsset | null> {
  const { data } = await supabaseAdmin
    .from("project_assets")
    .select("*")
    .eq("project_id", projectId)
    .eq("checksum", checksum)
    .maybeSingle();
  return data ? rowToProjectAsset(data as ProjectAssetRow) : null;
}

export async function createPreviewCapture(input: {
  projectId: string;
  missionId: string;
  buildId: string;
  userId: string;
  viewport: PreviewCapture["viewport"];
  width: number;
  height: number;
  screenshotUrl?: string | null;
  consoleErrors?: string[];
  pageErrors?: string[];
  failedRequests?: string[];
  horizontalOverflow?: boolean;
  documentWidth?: number | null;
  viewportWidth?: number | null;
  brokenImages?: number;
  missingFonts?: number;
  layoutShifts?: Array<{ value: number; hadRecentInput: boolean }>;
}): Promise<PreviewCapture> {
  const { data, error } = await supabaseAdmin
    .from("preview_captures")
    .insert({
      project_id: input.projectId,
      mission_id: input.missionId,
      build_id: input.buildId,
      user_id: input.userId,
      viewport: input.viewport,
      width: input.width,
      height: input.height,
      screenshot_url: input.screenshotUrl ?? null,
      console_errors: input.consoleErrors ?? [],
      page_errors: input.pageErrors ?? [],
      failed_requests: input.failedRequests ?? [],
      horizontal_overflow: input.horizontalOverflow ?? false,
      document_width: input.documentWidth ?? null,
      viewport_width: input.viewportWidth ?? null,
      broken_images: input.brokenImages ?? 0,
      missing_fonts: input.missingFonts ?? 0,
      layout_shifts: input.layoutShifts ?? [],
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create preview capture: ${error?.message ?? "unknown error"}`);
  }

  return rowToPreviewCapture(data as PreviewCaptureRow);
}

export async function updatePreviewCapture(
  captureId: string,
  updates: Partial<{
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
  }>,
): Promise<PreviewCapture | null> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.screenshotUrl !== undefined) payload.screenshot_url = updates.screenshotUrl;
  if (updates.consoleErrors !== undefined) payload.console_errors = updates.consoleErrors;
  if (updates.pageErrors !== undefined) payload.page_errors = updates.pageErrors;
  if (updates.failedRequests !== undefined) payload.failed_requests = updates.failedRequests;
  if (updates.horizontalOverflow !== undefined) payload.horizontal_overflow = updates.horizontalOverflow;
  if (updates.documentWidth !== undefined) payload.document_width = updates.documentWidth;
  if (updates.viewportWidth !== undefined) payload.viewport_width = updates.viewportWidth;
  if (updates.brokenImages !== undefined) payload.broken_images = updates.brokenImages;
  if (updates.missingFonts !== undefined) payload.missing_fonts = updates.missingFonts;
  if (updates.layoutShifts !== undefined) payload.layout_shifts = updates.layoutShifts;

  const { data } = await supabaseAdmin
    .from("preview_captures")
    .update(payload)
    .eq("id", captureId)
    .select()
    .maybeSingle();

  return data ? rowToPreviewCapture(data as PreviewCaptureRow) : null;
}

export async function createVisualReview(input: {
  projectId: string;
  missionId: string;
  buildId: string;
  userId: string;
  score: number;
  verdict: VisualReview["verdict"];
  findings: VisualReview["findings"];
}): Promise<VisualReview> {
  const { data, error } = await supabaseAdmin
    .from("visual_reviews")
    .insert({
      project_id: input.projectId,
      mission_id: input.missionId,
      build_id: input.buildId,
      user_id: input.userId,
      score: input.score,
      verdict: input.verdict,
      findings: input.findings,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create visual review: ${error?.message ?? "unknown error"}`);
  }

  return rowToReview(data as VisualReviewRow);
}

export async function updateVisualReview(
  reviewId: string,
  updates: Partial<{ score: number; verdict: VisualReview["verdict"]; findings: Record<string, unknown>[] }>,
): Promise<VisualReview | null> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.score !== undefined) payload.score = updates.score;
  if (updates.verdict !== undefined) payload.verdict = updates.verdict;
  if (updates.findings !== undefined) payload.findings = updates.findings;

  const { data } = await supabaseAdmin
    .from("visual_reviews")
    .update(payload)
    .eq("id", reviewId)
    .select()
    .maybeSingle();

  return data ? rowToReview(data as VisualReviewRow) : null;
}

export async function getVisualReview(buildId: string): Promise<VisualReview | null> {
  const { data } = await supabaseAdmin
    .from("visual_reviews")
    .select("*")
    .eq("build_id", buildId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? rowToReview(data as VisualReviewRow) : null;
}

export async function getVisualPlan(buildId: string): Promise<VisualPlan | null> {
  const { data } = await supabaseAdmin
    .from("visual_plans")
    .select("*")
    .eq("build_id", buildId)
    .maybeSingle();
  return data ? rowToPlan(data as VisualPlanRow) : null;
}

export async function getAssetManifest(buildId: string): Promise<AssetManifest | null> {
  const { data } = await supabaseAdmin
    .from("visual_asset_manifests")
    .select("*")
    .eq("build_id", buildId)
    .maybeSingle();
  return data ? rowToManifest(data as VisualAssetManifestRow) : null;
}

export async function getPreviewCapture(buildId: string): Promise<PreviewCapture | null> {
  const { data } = await supabaseAdmin
    .from("preview_captures")
    .select("*")
    .eq("build_id", buildId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? rowToPreviewCapture(data as PreviewCaptureRow) : null;
}
