/**
 * Station Control Bridge — deploy station adapters (chunk B, server-only).
 *
 * Thin adapters over the real LiTT tools. No business logic lives here:
 * every execute delegates to the tool registry (real I/O) or returns an
 * honest failure — never a placeholder success.
 *
 * Delegate map:
 * - deploy.preview    → project.deploy ({}) — approval-gated
 * - deploy.production → project.deploy ({}) — approval-gated
 * - deploy.status     → deploy.verify  ({url})
 *
 * IMPORTANT CORRECTION vs the audit's gap matrix: the audit mapped
 * deploy.preview/production to `deploy.execute`. That tool redeploys
 * LiTT's OWN Railway service (tool-registry.ts:1942 comment: "the LiTT app
 * itself, not the user's project") and is opt-in gated. The correct
 * backend for deploying the USER's project is `project.deploy`
 * (tool-registry.ts:1404 → deployUserProject → LiTT Hosting, public URL,
 * HTTP-verified before reporting success).
 *
 * SHAPE DIFFERENCES (reported):
 * - Neither deploy.execute nor project.deploy takes a target/environment
 *   argument: V1 has exactly ONE deploy target (LiTT Hosting's static tier —
 *   see deploy-service.ts: "The only deployment target in V1"). The
 *   contract's preview/production split has no backend counterpart, so both
 *   actions delegate to project.deploy and publish to the same public URL.
 *   The descriptions say this plainly; both stay approval-gated so the user
 *   approves every publish. (The private dev-server preview is preview.launch.)
 * - deploy.verify requires {url} but the contract lists deploy.status args
 *   as {}. This action accepts an optional url and fails honestly when it
 *   is missing — there is no "latest deployment" lookup tool to default to.
 */
import "server-only";

import { z } from "zod";

import { registerStationAction } from "../registry";
import { delegateToTool } from "../delegate";
import { setDelegateToolId } from "../advertise";
import type {
  StationAction,
  StationExecutionContext,
  StationResult,
} from "../types";
import { fail, stationResultSchema } from "./creator-helpers";

/**
 * Register a station action. Generic over the args schema so execute bodies
 * get a typed `args` instead of unknown. The executor safeParses raw args
 * against argsSchema before invoking execute, so the cast to the erased
 * StationAction is sound.
 */
function defineAction<A extends z.ZodType>(
  action: StationAction<A, StationResult>,
): void {
  registerStationAction(action as StationAction);
}

const projectDeployExecute = delegateToTool("project.deploy");
const deployVerifyExecute = delegateToTool("deploy.verify");

defineAction({
  id: "deploy.preview",
  station: "deploy",
  description:
    "Deploy the user's project to its live URL (delegates to the real project.deploy: collects, " +
    "publishes to LiTT Hosting, and HTTP-verifies before reporting success). " +
    "NOTE: V1 has a single deploy target — there is no separate preview channel, so this publishes " +
    "to the same public URL as deploy.production. Approval-gated. The private dev-server preview is preview.launch.",
  argsSchema: z.object({}),
  resultType: stationResultSchema,
  mutating: true,
  requiresApproval: true,
  execute: async (_args, ctx): Promise<StationResult> => {
    return projectDeployExecute({}, ctx);
  },
});
setDelegateToolId("deploy.preview", "project.deploy");

defineAction({
  id: "deploy.production",
  station: "deploy",
  description:
    "Deploy the user's project to its public live URL (delegates to the real project.deploy: " +
    "collects, publishes to LiTT Hosting, and HTTP-verifies before reporting success). Approval-gated.",
  argsSchema: z.object({}),
  resultType: stationResultSchema,
  mutating: true,
  requiresApproval: true,
  execute: async (_args, ctx): Promise<StationResult> => {
    return projectDeployExecute({}, ctx);
  },
});
setDelegateToolId("deploy.production", "project.deploy");

defineAction({
  id: "deploy.status",
  station: "deploy",
  description:
    "Verify a deployed URL is reachable and healthy (delegates to the real deploy.verify). " +
    "Read-only. The contract lists no args, but the backend requires the URL to check — " +
    "pass the publicUrl returned by deploy.preview/deploy.production.",
  argsSchema: z.object({
    url: z.string().url().optional().describe("Deployed URL to verify (required)"),
  }),
  resultType: stationResultSchema,
  mutating: false,
  execute: async (args, ctx): Promise<StationResult> => {
    if (!args.url) {
      return fail(
        "deploy.status needs the deployed URL to check (e.g. the publicUrl from deploy.preview). " +
          "There is no latest-deployment lookup — pass url explicitly.",
        "invalid_args",
      );
    }
    return deployVerifyExecute({ url: args.url }, ctx);
  },
});
setDelegateToolId("deploy.status", "deploy.verify");

export const DEPLOY_STATION_ACTIONS = [
  "deploy.preview",
  "deploy.production",
  "deploy.status",
] as const;
