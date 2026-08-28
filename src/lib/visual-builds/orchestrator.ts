import { createHash } from "crypto";
import { createMission, createRun, createStep, getMission, updateMissionStatus, updateRunStatus, updateStepStatus } from "@/lib/missions/mission-repository";
import { getProject, updateProjectRuntime, verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { createTerminalToken } from "@/lib/terminal-auth";
import { logFileOperation } from "@/lib/file-audit";
import { visualBuildsTotal, visualBuildDurationSeconds } from "@/lib/metrics";
import { capturePreviewWithChrome } from "./capture";
import { getTerminalServerUrl } from "@/lib/terminal-url";
import { buildAssetQuery, createImageGenerationProvider, createStockAssetProvider } from "./providers";
import { assetInspectionIsValid, DEFAULT_VISUAL_ASSET_ALLOWLIST, inspectAsset, inspectAssetBuffer } from "./security";
import {
  createAssetManifest,
  createPreviewCapture,
  createVisualBuild,
  createVisualPlan,
  createVisualReview,
  getAssetManifest,
  listProjectAssets,
  updateAssetManifest,
  updatePreviewCapture,
  updateVisualBuild,
} from "./repository";
import {
  applyRepairToSource,
  buildStaticPreviewHtml as buildLandingPageSource,
  buildVisualPlan,
  determineBudget,
  evaluateCompletionGate,
  reviewCaptures,
  routeVisualSource,
} from "./qa";
import { storeProjectAsset } from "./storage";
import { emitVisualBuildEvent } from "./observability";
import { type AssetManifest, type PreviewCapture, type ProjectAsset, type VisualBuild, type VisualBuildRequest, type VisualPlan, type VisualReview } from "./types";

const APP_BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const TERMINAL_BASE = () => {
  const raw = process.env.TERMINAL_SERVER_INTERNAL_URL ?? "";
  return raw && !raw.includes("localhost")
    ? raw
    : getTerminalServerUrl();
};

interface VisualBuildExecutionResult {
  build: VisualBuild;
  missionId: string;
  runId: string;
  plan: VisualPlan;
  manifest: AssetManifest | null;
  review: VisualReview | null;
  captures: PreviewCapture[];
  complete: boolean;
  repairApplied: boolean;
  changedFiles: Array<{ path: string; diff: string; reason: string }>;
}

async function writeWorkspaceFile(input: {
  workspaceId: string;
  userId: string;
  projectId: string;
  path: string;
  content: string;
}) {
  const { token } = createTerminalToken(input.userId, { workspaceId: input.workspaceId });
  const response = await fetch(`${TERMINAL_BASE()}/ws-files/write`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Workspace-Id": input.workspaceId,
    },
    body: JSON.stringify({ path: input.path, content: input.content }),
  });
  const ok = response.ok;
  // Audit log the AI-driven file write
  await logFileOperation({
    userId: input.userId,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    action: "write",
    path: input.path,
    contentLength: input.content.length,
    source: "mission",
    ok,
    error: ok ? undefined : "Visual build file write failed",
  }).catch(() => {});
  if (!ok) {
    throw new Error(await response.text().catch(() => "Failed to write workspace file"));
  }
}

function makeDiff(before: string, after: string): string {
  if (before === after) return "";
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const removed = beforeLines.find((line) => !afterLines.includes(line));
  const added = afterLines.find((line) => !beforeLines.includes(line));
  return [removed ? `- ${removed}` : null, added ? `+ ${added}` : null].filter(Boolean).join("\n");
}

async function inspectGeneratedAsset(result: { downloadUrl: string; provider: string; width: number | null; height: number | null; prompt: string; originalUrl: string | null; attribution: string | null; license: string | null; sectionKey: string; costCents: number; }, minimumWidth: number, minimumHeight: number) {
  if (result.downloadUrl.startsWith("data:")) {
    const match = result.downloadUrl.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/);
    if (!match) {
      throw new Error("Invalid generated data URL");
    }
    const contentType = match[1] || "image/png";
    const bytes = Buffer.from(match[3] || "", match[2] ? "base64" : "utf8");
    return inspectAssetBuffer(bytes, contentType, {
      minimumWidth,
      minimumHeight,
      targetAspectRatio: null,
    });
  }

  return inspectAsset(result.downloadUrl, {
    allowedHosts: [...DEFAULT_VISUAL_ASSET_ALLOWLIST],
    minimumWidth,
    minimumHeight,
  });
}

export async function runVisualBuild(input: {
  projectId: string;
  userId: string;
  request: VisualBuildRequest;
}): Promise<VisualBuildExecutionResult> {
  const _vbStartTime = Date.now();
  const project = await getProject(input.projectId, input.userId);
  if (!project) {
    throw new Error("Project not found");
  }

  const { workspaceId } = await verifyProjectWorkspace(input.projectId, input.userId);
  const budget = determineBudget(input.request);
  const mission = input.request.missionId
    ? await getMission(input.request.missionId, input.userId).then((existing) => {
        if (!existing || existing.projectId !== input.projectId) {
          throw new Error("Mission not found for project");
        }
        return existing;
      })
    : await createMission({
        projectId: input.projectId,
        userId: input.userId,
        name: input.request.prompt.slice(0, 80),
        description: input.request.prompt,
        graph: { kind: "visual-build", prompt: input.request.prompt },
      });

  const run = await createRun(mission.id, input.projectId, input.userId);
  let build = await createVisualBuild({
    projectId: input.projectId,
    missionId: mission.id,
    workspaceId,
    userId: input.userId,
    budget,
    request: { ...input.request, missionId: mission.id },
    status: "planning_visuals",
    repairLimit: 1,
    summary: { history: [{ stage: "queued", at: new Date().toISOString() }] },
  });

  const planningStep = await createStep({
    runId: run.id,
    missionId: mission.id,
    nodeId: "visual-plan",
    nodeType: "planning",
    title: "Create visual plan",
    sequenceOrder: 0,
    input: input.request,
  });

  const plan = buildVisualPlan({
    projectId: input.projectId,
    missionId: mission.id,
    workspaceId,
    request: input.request,
    projectName: project.name,
  });
  const savedPlan = await createVisualPlan({
    projectId: input.projectId,
    missionId: mission.id,
    buildId: build.id,
    userId: input.userId,
    plan: {
      ...plan,
      workspaceId,
    },
  });
  await emitVisualBuildEvent({
    buildId: build.id, projectId: input.projectId, missionId: mission.id, userId: input.userId,
    stage: "planning_visuals", event: "plan_created", level: "success",
    payload: { planId: savedPlan.id, sectionCount: plan.sectionRequirements.length },
  });
  build = await updateVisualBuild(build.id, {
    status: "searching_project_assets",
    visualPlanId: savedPlan.id,
    summary: {
      history: [
        { stage: "visual plan v1", at: new Date().toISOString() },
      ],
      prompt: input.request.prompt,
    },
  }) as VisualBuild;

  await updateStepStatus(planningStep.id, "completed", { visualPlanId: savedPlan.id, plan: savedPlan });

  const projectAssets = await listProjectAssets(input.projectId, { limit: 12 });
  const usableProjectAssets = projectAssets.filter((asset) => asset.inspection.quality !== "invalid");
  await emitVisualBuildEvent({
    buildId: build.id, projectId: input.projectId, missionId: mission.id, userId: input.userId,
    stage: "searching_project_assets", event: "project_assets_searched",
    payload: { total: projectAssets.length, usable: usableProjectAssets.length },
  });

  const sourceMode = routeVisualSource(input.request.visualSource, input.request.imageSource, usableProjectAssets.length);
  const stockProvider = createStockAssetProvider();
  const imageProvider = createImageGenerationProvider();
  const heroSection = plan.sectionRequirements[0];
  const stockQuery = buildAssetQuery(input.request.prompt, heroSection.key);
  const stockResults = budget.maxStockSearches > 0 ? await stockProvider.search({
    projectId: input.projectId,
    missionId: mission.id,
    query: stockQuery,
    sectionKey: heroSection.key,
    maxResults: budget.maxStockSearches,
  }).catch(() => []) : [];

  build = await updateVisualBuild(build.id, { status: "searching_stock_assets" }) as VisualBuild;
  await emitVisualBuildEvent({
    buildId: build.id, projectId: input.projectId, missionId: mission.id, userId: input.userId,
    stage: "searching_stock_assets", event: "stock_assets_searched",
    payload: { query: stockQuery, resultCount: stockResults.length },
  });

  const acquiredAssets: ProjectAsset[] = [];
  const manifestSeed: Array<Record<string, unknown>> = [];

  const selectedProjectAsset = usableProjectAssets[0] ?? null;
  if (selectedProjectAsset) {
    acquiredAssets.push(selectedProjectAsset);
    manifestSeed.push({
      assetId: selectedProjectAsset.id,
      sourceType: selectedProjectAsset.sourceType,
      provider: selectedProjectAsset.provider,
      originalUrl: selectedProjectAsset.originalUrl,
      storedUrl: selectedProjectAsset.storedUrl,
      checksum: selectedProjectAsset.checksum,
      inspection: selectedProjectAsset.inspection,
      selected: true,
    });
  }

  let selectedStockAsset: ProjectAsset | null = null;
  for (const result of stockResults) {
    const inspection = await inspectAsset(result.downloadUrl, {
      allowedHosts: [...DEFAULT_VISUAL_ASSET_ALLOWLIST],
      minimumWidth: 960,
      minimumHeight: 540,
      targetAspectRatio: 16 / 9,
      seenChecksums: new Set(acquiredAssets.map((asset) => asset.checksum)),
    }).catch((error) => ({
      reachable: false,
      statusCode: 0,
      contentType: "",
      width: null,
      height: null,
      bytes: 0,
      aspectRatio: null,
      hasAlpha: null,
      animated: false,
      checksum: createHash("sha256").update(String(error)).digest("hex"),
      quality: "invalid" as const,
      rejectionReasons: [error instanceof Error ? error.message : "Stock asset inspection failed"],
    }));

    if (!assetInspectionIsValid(inspection)) {
      await emitVisualBuildEvent({
        buildId: build.id, projectId: input.projectId, missionId: mission.id, userId: input.userId,
        stage: "searching_stock_assets", event: "asset_rejected", level: "warn",
        payload: { provider: result.provider, url: result.downloadUrl, reasons: inspection.rejectionReasons },
      });
      continue;
    }

    const stored = await storeProjectAsset({
      projectId: input.projectId,
      missionId: mission.id,
      buildId: build.id,
      userId: input.userId,
      sourceType: "stock",
      provider: result.provider,
      sourceUrl: result.downloadUrl,
      originalUrl: result.originalUrl,
      inspection,
      attribution: result.attribution,
      license: result.license,
      query: result.query,
      sectionKey: result.sectionKey,
      allowedHosts: [...DEFAULT_VISUAL_ASSET_ALLOWLIST],
    });

    selectedStockAsset = stored;
    acquiredAssets.push(stored);
    await emitVisualBuildEvent({
      buildId: build.id, projectId: input.projectId, missionId: mission.id, userId: input.userId,
      stage: "searching_stock_assets", event: "asset_stored", level: "success",
      payload: { assetId: stored.id, provider: stored.provider, checksum: stored.checksum },
    });
    manifestSeed.push({
      assetId: stored.id,
      sourceType: stored.sourceType,
      provider: stored.provider,
      originalUrl: stored.originalUrl,
      storedUrl: stored.storedUrl,
      checksum: stored.checksum,
      inspection: stored.inspection,
      selected: false,
    });
    break;
  }

  build = await updateVisualBuild(build.id, { status: "generating_assets" }) as VisualBuild;

  const generated = await imageProvider.generate({
    projectId: input.projectId,
    missionId: mission.id,
    prompt: `${input.request.prompt} branded hero image, polished, project-owned delivery, no text overlays`,
    negativePrompt: input.request.artDirection === "minimal" ? "busy collage, low contrast" : "blurry, text, watermark",
    aspectRatio: "16:9",
    width: 1600,
    height: 900,
    sectionKey: heroSection.key,
  });

  const generatedInspection = await inspectGeneratedAsset(generated, 960, 540);
  let generatedAsset: ProjectAsset | null = null;
  if (assetInspectionIsValid(generatedInspection)) {
    generatedAsset = await storeProjectAsset({
      projectId: input.projectId,
      missionId: mission.id,
      buildId: build.id,
      userId: input.userId,
      sourceType: "generated",
      provider: generated.provider,
      sourceUrl: generated.downloadUrl,
      originalUrl: generated.originalUrl,
      inspection: generatedInspection,
      attribution: generated.attribution,
      license: generated.license,
      prompt: generated.prompt,
      sectionKey: generated.sectionKey,
      allowedHosts: [...DEFAULT_VISUAL_ASSET_ALLOWLIST],
    });
    acquiredAssets.push(generatedAsset);
    manifestSeed.push({
      assetId: generatedAsset.id,
      sourceType: generatedAsset.sourceType,
      provider: generatedAsset.provider,
      originalUrl: generatedAsset.originalUrl,
      storedUrl: generatedAsset.storedUrl,
      checksum: generatedAsset.checksum,
      inspection: generatedAsset.inspection,
      selected: false,
    });
  }

  const preferredSource = sourceMode;
  const selectedAsset = acquiredAssets.find((asset) => asset.sourceType === preferredSource && asset.inspection.quality === "usable")
    ?? acquiredAssets.find((asset) => asset.inspection.quality === "usable")
    ?? null;

  const assetManifest = await createAssetManifest({
    projectId: input.projectId,
    missionId: mission.id,
    buildId: build.id,
    userId: input.userId,
    manifest: {
      assets: manifestSeed,
      selectedAssetId: selectedAsset?.id ?? null,
      stockSearches: stockResults.length,
      generatedAssetId: generatedAsset?.id ?? null,
      sourceMode,
    },
    selectedCount: acquiredAssets.filter((asset) => asset.inspection.quality === "usable").length,
    rejectedCount: manifestSeed.length - acquiredAssets.filter((asset) => asset.inspection.quality === "usable").length,
  });

  build = await updateVisualBuild(build.id, {
    status: "saving_assets",
    assetManifestId: assetManifest.id,
    summary: {
      history: [
        { stage: "visual plan v1", at: new Date().toISOString() },
        { stage: "assets selected", at: new Date().toISOString() },
      ],
      selectedAssetId: selectedAsset?.id ?? null,
      generatedAssetId: generatedAsset?.id ?? null,
      stockAssetId: selectedStockAsset?.id ?? null,
    },
  }) as VisualBuild;

  const landingPath = "index.html";
  const workspaceSource = buildLandingPageSource({
    plan: savedPlan,
    primaryAsset: selectedAsset ?? generatedAsset ?? selectedProjectAsset,
    repairPass: 0,
  });

  const buildStep = await createStep({
    runId: run.id,
    missionId: mission.id,
    nodeId: "workspace-build",
    nodeType: "build",
    title: "Build landing page",
    sequenceOrder: 1,
    input: { landingPath, sourceMode },
  });

  build = await updateVisualBuild(build.id, { status: "building" }) as VisualBuild;
  await writeWorkspaceFile({
    workspaceId,
    userId: input.userId,
    projectId: input.projectId,
    path: landingPath,
    content: workspaceSource,
  });
  await updateStepStatus(buildStep.id, "completed", { path: landingPath });

  const previewUrlPath = `/api/studio-projects/${input.projectId}/preview/proxy`;
  const previewUrl = new URL(previewUrlPath, APP_BASE_URL).toString();
  build = await updateVisualBuild(build.id, { status: "rendering", summary: { ...(build.summary ?? {}), previewUrl: previewUrlPath } }) as VisualBuild;
  await updateProjectRuntime(input.projectId, input.userId, {
    runtimeStatus: "ready",
    previewUrl: previewUrlPath,
    runtimeError: null,
  });
  await emitVisualBuildEvent({
    buildId: build.id, projectId: input.projectId, missionId: mission.id, userId: input.userId,
    stage: "rendering", event: "preview_ready", level: "success",
    payload: { previewUrl: previewUrlPath },
  });
  const captureSpecs = [
    { viewport: "desktop" as const, width: 1440, height: 1000 },
    { viewport: "mobile" as const, width: 390, height: 844 },
  ];

  const captures: PreviewCapture[] = [];
  for (const spec of captureSpecs) {
    build = await updateVisualBuild(build.id, { status: "capturing" }) as VisualBuild;
    const result = await capturePreviewWithChrome({ url: previewUrl, ...spec, timeoutMs: budget.timeoutSeconds * 1000 }).catch((error) => {
      throw new Error(`Preview capture failed for ${spec.viewport}: ${error instanceof Error ? error.message : String(error)}`);
    });
    const screenshotUrl = result.screenshot.length > 0 ? (await import("@/lib/r2")).uploadBinaryAsset(
      input.userId,
      `${spec.viewport}.png`,
      result.screenshot,
      "image/png",
      "image",
    ).then((uploaded) => uploaded.publicUrl) : null;
    const capture = await createPreviewCapture({
      projectId: input.projectId,
      missionId: mission.id,
      buildId: build.id,
      userId: input.userId,
      viewport: spec.viewport,
      width: spec.width,
      height: spec.height,
      screenshotUrl: await screenshotUrl,
      consoleErrors: result.consoleErrors,
      pageErrors: result.pageErrors,
      failedRequests: result.failedRequests,
      horizontalOverflow: result.horizontalOverflow,
      documentWidth: result.documentWidth,
      viewportWidth: result.viewportWidth,
      brokenImages: result.brokenImages,
      missingFonts: result.missingFonts,
      layoutShifts: result.layoutShifts,
    });
    captures.push(capture);
  }

  const reviewStep = await createStep({
    runId: run.id,
    missionId: mission.id,
    nodeId: "visual-review",
    nodeType: "review",
    title: "Review captures",
    sequenceOrder: 2,
    input: { captures: captures.map((capture) => capture.viewport) },
  });

  build = await updateVisualBuild(build.id, { status: "reviewing" }) as VisualBuild;
  const visualReview = reviewCaptures({ captures, requiredAssetCount: acquiredAssets.length });
  const savedReview = await createVisualReview({
    projectId: input.projectId,
    missionId: mission.id,
    buildId: build.id,
    userId: input.userId,
    score: visualReview.score,
    verdict: visualReview.verdict,
    findings: visualReview.findings,
  });
  await updateStepStatus(reviewStep.id, "completed", { review: savedReview });
  await emitVisualBuildEvent({
    buildId: build.id, projectId: input.projectId, missionId: mission.id, userId: input.userId,
    stage: "reviewing", event: "review_completed", level: savedReview.verdict === "pass" ? "success" : "warn",
    payload: { score: savedReview.score, verdict: savedReview.verdict, findingCount: savedReview.findings.length },
  });

  const invalidAssetCount = acquiredAssets.filter((asset) => asset.inspection.quality === "invalid").length;
  const failedViewports = captures.filter((capture) => capture.horizontalOverflow || capture.brokenImages > 0).map((capture) => capture.viewport);
  let repairApplied = false;
  const changedFiles: Array<{ path: string; diff: string; reason: string }> = [];
  let currentSource = workspaceSource;
  let currentReview = savedReview;

  const shouldRepair = visualReview.verdict === "repair" && build.repairPass < 1;
  if (shouldRepair) {
    const repairedSource = applyRepairToSource(currentSource, visualReview.findings);
    if (repairedSource !== currentSource) {
      repairApplied = true;
      const repairStep = await createStep({
        runId: run.id,
        missionId: mission.id,
        nodeId: "repair-pass-1",
        nodeType: "repair",
        title: "Repair visual issues",
        sequenceOrder: 3,
        input: { findings: visualReview.findings },
      });
      const diff = makeDiff(currentSource, repairedSource);
      changedFiles.push({ path: landingPath, diff, reason: visualReview.findings.map((finding) => finding.repairInstruction).join(" | ") });
      await writeWorkspaceFile({ workspaceId, userId: input.userId, projectId: input.projectId, path: landingPath, content: repairedSource });
      currentSource = repairedSource;
      build = await updateVisualBuild(build.id, {
        status: "repairing",
        repairPass: 1,
        summary: {
          ...(build.summary ?? {}),
          repairs: [{ path: landingPath, diff, reason: changedFiles[0].reason }],
        },
      }) as VisualBuild;
      await updateStepStatus(repairStep.id, "completed", { changedFiles });
      await emitVisualBuildEvent({
        buildId: build.id, projectId: input.projectId, missionId: mission.id, userId: input.userId,
        stage: "repairing", event: "repair_applied", level: "success",
        payload: { files: changedFiles.map((f) => f.path), findingCount: visualReview.findings.length },
      });

      const repairedPreviewUrl = previewUrl;
      const repairedCaptures: PreviewCapture[] = [];
      for (const spec of captureSpecs) {
        const result = await capturePreviewWithChrome({ url: repairedPreviewUrl, ...spec, timeoutMs: budget.timeoutSeconds * 1000 });
        const screenshotUrl = result.screenshot.length > 0
          ? (await import("@/lib/r2")).uploadBinaryAsset(
            input.userId,
            `${spec.viewport}-repair.png`,
            result.screenshot,
            "image/png",
            "image",
          ).then((uploaded) => uploaded.publicUrl)
          : null;
        const capture = await updatePreviewCapture(
          captures.find((item) => item.viewport === spec.viewport)?.id ?? "",
          {
            screenshotUrl: await screenshotUrl,
            consoleErrors: result.consoleErrors,
            pageErrors: result.pageErrors,
            failedRequests: result.failedRequests,
            horizontalOverflow: result.horizontalOverflow,
            documentWidth: result.documentWidth,
            viewportWidth: result.viewportWidth,
            brokenImages: result.brokenImages,
            missingFonts: result.missingFonts,
            layoutShifts: result.layoutShifts,
          },
        );
        if (capture) repairedCaptures.push(capture);
      }
      captures.splice(0, captures.length, ...repairedCaptures);
      currentReview = reviewCaptures({ captures, requiredAssetCount: acquiredAssets.length });
    }
  }

  const complete = evaluateCompletionGate({
    previewReady: Boolean(previewUrl),
    invalidAssetCount,
    horizontalOverflow: captures.some((capture) => capture.horizontalOverflow),
    failedViewports,
    visualReview: currentReview,
    requiredSections: plan.sectionRequirements.map((section) => ({ present: Boolean(selectedAsset || selectedStockAsset || generatedAsset) || !section.required })),
  });

  build = await updateVisualBuild(build.id, {
    status: complete ? "complete" : currentReview.verdict === "repair" ? "partial" : "failed",
    assetManifestId: assetManifest.id,
    summary: {
      ...(build.summary ?? {}),
      complete,
      reviewScore: currentReview.score,
      reviewVerdict: currentReview.verdict,
      changedFiles,
      captures: captures.map((capture) => ({ viewport: capture.viewport, horizontalOverflow: capture.horizontalOverflow, brokenImages: capture.brokenImages })),
      history: [
        { stage: "visual plan v1", at: new Date().toISOString() },
        { stage: "assets selected", at: new Date().toISOString() },
        { stage: "build v1", at: new Date().toISOString() },
        { stage: "review v1", at: new Date().toISOString() },
        ...(repairApplied ? [{ stage: "repair v1", at: new Date().toISOString() }] : []),
      ],
    },
  }) as VisualBuild;

  await updateAssetManifest(assetManifest.id, {
    manifest: {
      assets: manifestSeed,
      selectedAssetId: selectedAsset?.id ?? null,
      stockAssetId: selectedStockAsset?.id ?? null,
      generatedAssetId: generatedAsset?.id ?? null,
      sourceMode,
      repairApplied,
    },
    selectedCount: acquiredAssets.filter((asset) => asset.inspection.quality === "usable").length,
    rejectedCount: manifestSeed.length - acquiredAssets.filter((asset) => asset.inspection.quality === "usable").length,
  });

  await updateMissionStatus(mission.id, input.userId, complete ? "completed" : "paused");
  await updateRunStatus(run.id, input.userId, complete ? "completed" : "failed", complete ? null : "Visual build ended in partial or failed state");
  await emitVisualBuildEvent({
    buildId: build.id, projectId: input.projectId, missionId: mission.id, userId: input.userId,
    stage: build.status, event: complete ? "build_complete" : build.status === "partial" ? "build_partial" : "build_failed",
    level: complete ? "success" : "error",
    payload: { reviewScore: currentReview.score, reviewVerdict: currentReview.verdict, repairApplied, captureCount: captures.length },
  });
  await updateProjectRuntime(input.projectId, input.userId, {
    runtimeStatus: "ready",
    previewUrl: previewUrlPath,
    runtimeError: null,
  });

  // Record visual build metrics
  const _vbDuration = Date.now() - _vbStartTime;
  visualBuildsTotal.labels({ stage: build.status, status: complete ? "success" : "failed" }).inc();
  visualBuildDurationSeconds.labels({ stage: build.status }).observe(_vbDuration / 1000);

  return {
    build,
    missionId: mission.id,
    runId: run.id,
    plan: savedPlan,
    manifest: await getAssetManifest(build.id),
    review: currentReview,
    captures,
    complete,
    repairApplied,
    changedFiles,
  };
}

