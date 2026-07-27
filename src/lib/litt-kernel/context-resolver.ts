/**
 * LiTT Context Resolver
 *
 * Resolves the active Kernel context from scattered state:
 *   - userId (from auth)
 *   - conversationId (from chat session)
 *   - projectId (from session context or active project)
 *   - missionId (from active mission, if any)
 *   - canvasId (from canvas focus state)
 *   - capabilities (from the capability registry)
 *   - world model (composed from the above)
 *
 * The Kernel calls this BEFORE making a control decision, so the
 * decision has full context.
 */

import type {
  CapabilityRecord,
  CanvasFocusState,
  KernelContext,
  LiTTWorldModel,
} from "./types";

// ─── Resolver input ─────────────────────────────────────────────

export interface ContextResolverInput {
  userId: string | null;
  conversationId: string | null;
  projectId: string | null;
  missionId: string | null;
  canvasId: string | null;
  capabilities: CapabilityRecord[];
  canvasFocus?: CanvasFocusState;
}

// ─── Resolver ───────────────────────────────────────────────────

/**
 * Composes a KernelContext from the input.
 * The decision is filled in by the Kernel after this returns.
 */
export function resolveContext(input: ContextResolverInput): Omit<KernelContext, "decision"> {
  const worldModel: LiTTWorldModel = {
    userGoals: [],
    activeProjectId: input.projectId,
    activeMissionId: input.missionId,
    activeCanvasId: input.canvasId,
    blockers: [],
    dependencies: [],
    assumptions: [],
    unknowns: [],
    decisions: [],
    confidence: 0.5,
    lastUpdatedAt: new Date().toISOString(),
  };

  const canvasFocus: CanvasFocusState = input.canvasFocus ?? {
    activeCanvasId: input.canvasId,
    recentCanvasIds: input.canvasId ? [input.canvasId] : [],
    pinnedCanvasIds: [],
    lastModifiedCanvasId: null,
    lastReferencedBlockId: null,
  };

  return {
    worldModel,
    capabilities: input.capabilities,
    canvasFocus,
    userId: input.userId,
    conversationId: input.conversationId,
    projectId: input.projectId,
    missionId: input.missionId,
    canvasId: input.canvasId,
  };
}
