import { randomUUID } from "crypto";
import {
  type PreviewCapture,
  type PreviewViewport,
  type ProjectAsset,
  type VisualBuildBudget,
  type VisualBuildRequest,
  type VisualMockupMode,
  type VisualPlan,
  type VisualQualityLevel,
  type VisualReview,
  type VisualReviewFinding,
  type VisualSourceType,
  defaultVisualBuildBudget,
} from "./types";

export interface BuildPlanInput {
  projectId: string;
  missionId: string;
  workspaceId: string;
  request: VisualBuildRequest;
  projectName: string;
}

export function determineBudget(request: VisualBuildRequest): VisualBuildBudget {
  return request.budget ?? defaultVisualBuildBudget(request.quality);
}

export function routeVisualSource(
  visualSource: VisualBuildRequest["visualSource"],
  imageSource: VisualBuildRequest["imageSource"],
  assetCount: number,
): VisualSourceType {
  if (visualSource === "project-assets") return "project";
  if (imageSource === "uploaded") return assetCount > 0 ? "project" : "uploaded";
  if (imageSource === "stock") return "stock";
  if (imageSource === "generated") return "generated";
  if (visualSource === "real-photos") return assetCount > 0 ? "project" : "stock";
  if (visualSource === "ai-generated") return "generated";
  return assetCount > 0 ? "project" : "stock";
}

export function buildVisualPlan(input: BuildPlanInput): VisualPlan {
  const qualityLevel = input.request.quality as VisualQualityLevel;
  const mockupMode = input.request.mockups as VisualMockupMode;
  const requestText = input.request.prompt.trim();
  const plan: VisualPlan = {
    id: randomUUID(),
    projectId: input.projectId,
    missionId: input.missionId,
    workspaceId: input.workspaceId,
    product: input.request.product?.trim() || input.projectName,
    audience: input.request.audience?.trim() || "People who need a credible, high-converting landing page",
    visualDirection:
      input.request.artDirection === "minimal"
        ? "Minimal, spacious, and product-led"
        : input.request.artDirection === "neon"
          ? "Neon, high-contrast, and cinematic"
          : input.request.artDirection === "editorial"
            ? "Editorial, structured, and premium"
            : "Branded, cinematic, and conversion-focused",
    brandColors:
      input.request.artDirection === "neon"
        ? ["#0f172a", "#22d3ee", "#a855f7", "#f97316"]
        : ["#020617", "#38bdf8", "#14b8a6", "#f8fafc"],
    typographyDirection:
      input.request.artDirection === "editorial"
        ? "Bold headline serif paired with a clean sans-serif body"
        : "Large, confident sans-serif headlines with compact supporting copy",
    densityAndLayoutDirection:
      qualityLevel === "cinematic"
        ? "High-impact hero with layered visual depth and generous spacing"
        : "Balanced sections with a focused hero, proof strip, and CTA",
    sectionRequirements: [
      {
        id: randomUUID(),
        key: "hero",
        title: "Hero section",
        required: true,
        requiredAssetType: "image",
        aspectRatio: "16:9",
        sourcePreference: input.request.imageSource === "stock" ? ["project", "stock"] : input.request.imageSource === "generated" ? ["project", "generated"] : ["project", "stock", "generated"],
        fallbackStrategy: "Use the best available project or stock image; fall back to a generated brand scene if needed.",
        copy: requestText,
      },
    ],
    qualityLevel,
    mockupMode,
    responsiveTargets: mockupMode === "mobile" ? ["mobile"] : mockupMode === "multi-device" ? ["desktop", "tablet", "mobile"] : ["desktop", "mobile"],
    request: {
      ...input.request,
      workspaceId: input.workspaceId,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return plan;
}

export function buildStaticPreviewHtml(args: {
  plan: VisualPlan;
  primaryAsset: ProjectAsset | null;
  repairPass: number;
}) {
  const image = args.primaryAsset?.storedUrl ?? "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=1600&fit=crop&q=80";
  const heroWidth = args.repairPass === 0 ? "100vw" : "100%";
  const overflow = args.repairPass === 0 ? "visible" : "hidden";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeJsString(args.plan.product)}</title>
    <style>
      :root { color-scheme: dark; }
      html, body { margin: 0; min-height: 100%; background: #020617; color: #f8fafc; font-family: Inter, system-ui, sans-serif; overflow-x: ${overflow}; }
      main { min-height: 100vh; overflow-x: ${overflow}; }
      .shell { max-width: 1120px; margin: 0 auto; padding: 72px 24px; display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 32px; align-items: center; }
      .hero { width: ${heroWidth}; border-radius: 32px; overflow: hidden; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.04); }
      .hero img { width: 100%; height: 560px; object-fit: cover; display: block; }
      .badge { display: inline-flex; border: 1px solid rgba(56,189,248,.25); background: rgba(56,189,248,.12); color: #7dd3fc; padding: 10px 14px; border-radius: 9999px; letter-spacing: .18em; text-transform: uppercase; font-size: 12px; font-weight: 700; }
      h1 { font-size: clamp(3rem, 7vw, 5.5rem); line-height: .9; margin: 0; }
      p { color: #cbd5e1; font-size: 18px; line-height: 1.8; }
      .cta { display: inline-flex; margin-right: 12px; margin-top: 12px; padding: 14px 20px; border-radius: 9999px; text-decoration: none; font-weight: 700; }
      .primary { background: #22d3ee; color: #020617; }
      .secondary { border: 1px solid rgba(255,255,255,.14); color: #fff; }
      .card { margin-top: 18px; padding: 18px; border-radius: 24px; border: 1px solid rgba(255,255,255,.1); background: rgba(2,6,23,.8); backdrop-filter: blur(18px); }
    </style>
  </head>
  <body>
    <main>
      <section class="shell">
        <div>
          <div class="badge">${escapeJsString(args.plan.visualDirection)}</div>
          <h1 style="margin-top: 20px;">${escapeJsString(args.plan.product)}</h1>
          <p>${escapeJsString(args.plan.audience)}</p>
          <a class="cta primary" href="#contact">Start the project</a>
          <a class="cta secondary" href="#proof">See the proof</a>
          <div class="card">
            <strong>Visual Plan</strong>
            <p style="margin: 8px 0 0;">${escapeJsString(args.plan.sectionRequirements[0]?.fallbackStrategy ?? "Use the best available asset")}</p>
          </div>
        </div>
        <div class="hero">
          <img src="${image}" alt="Primary visual" />
        </div>
      </section>
    </main>
  </body>
</html>`;
}

function escapeJsString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

export function evaluateCompletionGate(input: {
  previewReady: boolean;
  invalidAssetCount: number;
  horizontalOverflow: boolean;
  failedViewports: PreviewViewport[];
  visualReview: VisualReview;
  requiredSections: Array<{ present: boolean }>;
}): boolean {
  return (
    input.previewReady &&
    input.invalidAssetCount === 0 &&
    input.horizontalOverflow === false &&
    input.failedViewports.length === 0 &&
    input.visualReview.verdict === "pass" &&
    input.requiredSections.every((section) => section.present)
  );
}

export function reviewCaptures(input: {
  captures: PreviewCapture[];
  requiredAssetCount: number;
}): VisualReview {
  const findings: VisualReviewFinding[] = [];
  let score = 100;

  for (const capture of input.captures) {
    if (capture.horizontalOverflow) {
      findings.push({
        category: "overflow",
        severity: capture.viewport === "mobile" ? "critical" : "high",
        viewport: capture.viewport,
        selector: "body",
        evidence: `${capture.viewport} viewport overflows horizontally (${capture.documentWidth ?? 0}px > ${capture.viewportWidth ?? 0}px)`,
        repairInstruction: "Add overflow-x-hidden to the root wrapper and replace any w-screen section width with w-full.",
      });
    }
    if (capture.brokenImages > 0) {
      findings.push({
        category: "broken_asset",
        severity: "critical",
        viewport: capture.viewport,
        evidence: `${capture.brokenImages} broken image element(s) detected`,
        repairInstruction: "Replace the broken image source with a stored project asset URL and ensure the image resolves during preview.",
      });
    }
    if (capture.consoleErrors.length > 0 || capture.pageErrors.length > 0 || capture.failedRequests.length > 0) {
      findings.push({
        category: "generic_design",
        severity: "medium",
        viewport: capture.viewport,
        evidence: [...capture.consoleErrors, ...capture.pageErrors, ...capture.failedRequests].slice(0, 3).join(" | "),
        repairInstruction: "Remove the runtime errors and confirm all required assets and requests are available in preview.",
      });
    }
    if (capture.missingFonts > 0) {
      findings.push({
        category: "typography",
        severity: "medium",
        viewport: capture.viewport,
        evidence: "Some fonts were not loaded during preview",
        repairInstruction: "Ensure typography uses available fonts or preloads the required font files.",
      });
    }
  }

  for (const finding of findings) {
    if (finding.severity === "critical") score -= 30;
    else if (finding.severity === "high") score -= 20;
    else if (finding.severity === "medium") score -= 10;
    else score -= 4;
  }

  if (input.requiredAssetCount === 0) {
    findings.push({
      category: "broken_asset",
      severity: "high",
      viewport: "desktop",
      evidence: "No usable assets were selected for the build",
      repairInstruction: "Select a usable project, stock, or generated asset before completing the build.",
    });
    score -= 20;
  }

  const hasCritical = findings.some((finding) => finding.severity === "critical");
  const verdict = hasCritical ? "repair" : findings.length > 0 ? "repair" : "pass";

  return {
    score: Math.max(0, Math.min(100, score)),
    verdict,
    findings,
  };
}

export function applyRepairToSource(source: string, findings: VisualReviewFinding[]): string {
  let repaired = source;
  const overflow = findings.some((finding) => finding.category === "overflow");
  if (overflow) {
    repaired = repaired.replace(/width: 100vw;/g, "width: 100%;");
    repaired = repaired.replace(/overflow-x: visible;/g, "overflow-x: hidden;");
    repaired = repaired.replace(/overflow-x: visible;/g, "overflow-x: hidden;");
  }
  return repaired;
}
