/**
 * The BuildConsole routing decision — extracted as a pure function so
 * integration tests drive the SAME logic the component runs, against
 * real routeIntent output instead of hand-written metadata.
 */

// Media/design intents route into the Studio surface that actually
// produces them — minting a blank-static project for an image, a video
// or a song was a silent misroute.
export const INTENT_SURFACES: Record<string, { creator?: string; tool?: string }> = {
  image: { creator: "image" },
  video: { creator: "video" },
  music: { creator: "music" },
  design: { tool: "design" },
};

// The media/design intent set — a mixed classification may route to a
// creator surface ONLY when every constituent is one of these. A mixed
// result containing code, website, debug, deploy, research or any other
// non-media intent is project work ("fix the image upload bug",
// "deploy the video app") and must fail closed to chat.
const MEDIA_INTENTS: ReadonlySet<string> = new Set(["image", "video", "music", "design"]);

// Project-scope intents for which the dashboard composer may mint a
// project up front — and only when the router reports an explicit,
// unambiguous new-project request (actionMatched && requestsNewProject).
// "mixed" and "agent_task" stay eligible so an explicit request like
// "create a new website project" (classified mixed) still works — the
// requestsNewProject signal is what gates them, not the intent alone.
const BUILD_INTENTS: ReadonlySet<string> = new Set(["code", "website", "game", "agent_task", "mixed"]);

export type BuildRouteDecision =
  | { kind: "create" }
  | { kind: "surface"; surface: { creator?: string; tool?: string }; mediaIntent: string }
  | { kind: "chat" };

/**
 * Decide where a dashboard-composer submission goes:
 *
 *  - "create"  — explicit, unambiguous new-project request: a matched
 *    create/generate verb AND the requestsNewProject signal AND a
 *    project-scope intent. Everything else fails closed.
 *  - "surface" — a media/design GENERATION request: a matched action
 *    AND the requestsMediaGeneration signal AND (a single media/design
 *    classification OR a mixed classification whose constituents are
 *    ALL media/design). Mixed containing any non-media constituent
 *    (code, website, debug, deploy, research, …) is work on a project,
 *    not a creator request — it falls to chat.
 *  - "chat"    — everything else.
 */
export function resolveBuildRoute(
  result: {
    primaryIntent?: string;
    secondaryIntents?: string[];
    intents?: string[];
    action?: string;
    actionMatched?: boolean;
    requestsNewProject?: boolean;
    requestsMediaGeneration?: boolean;
  } | null | undefined,
): BuildRouteDecision {
  const actionMatched = result?.actionMatched === true;
  const requestsNewProject = result?.requestsNewProject === true;
  const requestsMediaGeneration = result?.requestsMediaGeneration === true;
  const action = result?.action;
  const primaryIntent = result?.primaryIntent;

  // Explicit new-project requests win over everything else — "create a
  // new website and a logo for it" mints the project; the media work
  // happens inside it.
  if (
    actionMatched &&
    requestsNewProject &&
    (action === "create" || action === "generate") &&
    typeof primaryIntent === "string" &&
    BUILD_INTENTS.has(primaryIntent)
  ) {
    return { kind: "create" };
  }

  if (!actionMatched || !requestsMediaGeneration || typeof primaryIntent !== "string") {
    return { kind: "chat" };
  }

  if (INTENT_SURFACES[primaryIntent]) {
    return { kind: "surface", surface: INTENT_SURFACES[primaryIntent], mediaIntent: primaryIntent };
  }

  if (primaryIntent === "mixed") {
    const constituents = result?.intents;
    if (
      Array.isArray(constituents) &&
      constituents.length > 0 &&
      constituents.every((intent) => MEDIA_INTENTS.has(intent))
    ) {
      const mediaIntent = constituents[0];
      return { kind: "surface", surface: INTENT_SURFACES[mediaIntent], mediaIntent };
    }
  }

  return { kind: "chat" };
}
