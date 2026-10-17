import type {
  ActionVerb,
  IntentRouterResult,
  LiTTIntent,
  RouterInput,
  RouterOutput,
} from "./types";

const has = (prompt: string, pattern: RegExp) => pattern.test(prompt);

function consequence(prompt: string): IntentRouterResult["consequence"] {
  if (has(prompt, /\b(delete|drop|destroy|remove production|wipe)\b/i)) return "destructive";
  if (has(prompt, /\b(deploy|publish|release|ship|push to prod|send|post)\b/i)) return "external_write";
  return "reversible";
}

function needsApproval(result: Pick<IntentRouterResult, "consequence" | "primaryIntent">): boolean {
  return result.consequence !== "reversible" || result.primaryIntent === "deploy";
}

/**
 * Project-scope deliverables — a request whose object is one of these is
 * a request for a NEW project. File-scope artifacts (function, component,
 * endpoint, test) are work INSIDE a project and never justify minting one.
 */
const PROJECT_DELIVERABLE =
  "(?:project|website|web\\s*site|web\\s*app|webapp|web\\s*page|webpage|landing\\s*page|home\\s*page|site|app|application|game)";

const NEW_PROJECT_PATTERNS = [
  // "new <deliverable>": "a new website", "new app", "my new project".
  new RegExp(`\\bnew\\s+(?:[\\w-]+\\s+){0,3}${PROJECT_DELIVERABLE}\\b`, "i"),
  // A creation verb governing a project deliverable: "create a website",
  // "build me an app", "spin up a landing page". Prepositions between the
  // verb and the noun ("working on the site", "changes to the app",
  // "image for my website") describe work on an existing project or a
  // non-project artifact and are excluded from the gap.
  new RegExp(
    `\\b(?:create|build|make|scaffold|generate|develop|spin\\s+up|set\\s+up(?=\\s+(?:a|an|new)\\b)|start(?=\\s+(?:a|an|new)\\b))\\b\\s+(?:me\\s+|us\\s+)?` +
      `(?:(?!on\\b|to\\b|into\\b|in\\b|inside\\b|within\\b|for\\b|of\\b|with\\b|about\\b|at\\b|existing\\b|current\\b)[\\w-]+\\s+){0,4}` +
      `${PROJECT_DELIVERABLE}\\b`,
    "i",
  ),
];

/**
 * True only for an unambiguous new-project request. Bare nouns, questions,
 * comparisons, file-scope artifacts, and edits to an existing project all
 * return false — the caller must fail closed.
 */
function promptRequestsNewProject(prompt: string): boolean {
  return NEW_PROJECT_PATTERNS.some((pattern) => pattern.test(prompt));
}

function intentForPrompt(prompt: string, context: RouterInput["context"]): {
  primaryIntent: LiTTIntent;
  secondaryIntents: LiTTIntent[];
  action: ActionVerb;
  actionMatched: boolean;
  requestsNewProject: boolean;
  goals: string[];
} {
  const intents: LiTTIntent[] = [];
  const add = (intent: LiTTIntent) => {
    if (!intents.includes(intent)) intents.push(intent);
  };
  // null when no verb pattern matches — "create" is only the fallback
  // label below and must never count as an explicit creation signal.
  const matchedAction: ActionVerb | null = (context.selectedAssetId && has(prompt, /\b(darker|lighter|edit|change|update|redesign|restyle|modify|variation)\b/i))
    ? "edit"
    : has(prompt, /\b(fix|debug|repair|resolve)\b/i)
      ? "fix"
      : has(prompt, /\b(edit|change|update|redesign|restyle|modify)\b/i)
      ? "edit"
      : has(prompt, /\b(deploy|publish|release|ship)\b/i)
        ? "deploy"
        : has(prompt, /\b(analy[sz]e|inspect|investigate|research|compare)\b/i)
          ? "analyze"
          : has(prompt, /\b(continue|again|another|same)\b/i)
            ? "continue"
            : has(prompt, /\b(generate|make|build|write)\b/i)
              ? "generate"
              : has(prompt, /\b(create|scaffold|spin\s*up|set\s*up|start\s+(?=a\s|an\s|new\s))/i)
                ? "create"
                : null;

  if (has(prompt, /\b(deploy|publish|release|ship|production|prod)\b/i)) add("deploy");
  if (has(prompt, /\b(fix|debug|repair|resolve|broken|error|bug|failed)\b/i)) add("debug");
  if (has(prompt, /\b(website|web site|web app|landing page|homepage|site)\b/i)) add("website");
  if (has(prompt, /\b(code|app|api|component|typescript|javascript|function|project)\b/i)) add("code");
  if (has(prompt, /\b(image|logo|artwork|illustration|picture|photo|graphic)\b/i)) add("image");
  if (has(prompt, /\b(video|clip|animation|motion)\b/i)) add("video");
  if (has(prompt, /\b(song|music|audio|soundtrack|beat|track)\b/i)) add("music");
  if (has(prompt, /\b(design|layout|wireframe|visual identity|brand direction)\b/i)) add("design");
  if (has(prompt, /\b(game|gameplay|level|playable)\b/i)) add("game");
  if (has(prompt, /\b(research|investigate|compare|find out|sources)\b/i)) add("research");
  if (has(prompt, /\b(agent|mission|workflow|automate)\b/i)) add("agent_task");

  if (intents.length === 0 && context.recentIntents?.[0] && has(prompt, /\b(another|again|same|that)\b/i)) {
    add(context.recentIntents[0]);
  }

  const primaryIntent = intents[0] ?? "project_action";
  const secondaryIntents = intents.slice(1);
  const finalPrimary = intents.length > 1 ? "mixed" : primaryIntent;
  return {
    primaryIntent: finalPrimary,
    secondaryIntents,
    action: matchedAction ?? "create",
    actionMatched: matchedAction !== null,
    requestsNewProject: promptRequestsNewProject(prompt),
    goals: [prompt.trim()],
  };
}

export async function routeIntent(input: RouterInput): Promise<RouterOutput> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return { type: "clarification", request: { question: "What would you like LiTT to do?" } };
  }

  const classification = intentForPrompt(prompt, input.context);
  const impact = consequence(prompt);
  const vague = /^(make it better|fix it|do something|help me|make this good)[.!?]*$/i.test(prompt);
  const hasUsefulContext = Boolean(
    input.context.activeProjectId ||
      input.context.selectedAssetId ||
      input.context.openFiles?.length ||
      input.context.deploymentState === "failed" ||
      input.context.recentIntents?.length,
  );

  if (vague && !hasUsefulContext) {
    return {
      type: "clarification",
      request: { question: "What should LiTT work on? Tell me the project, file, asset, or result you want changed." },
    };
  }

  const targetProjectId = input.context.activeProjectId;
  const result: IntentRouterResult = {
    schemaVersion: "1.1",
    primaryIntent: classification.primaryIntent,
    secondaryIntents: classification.secondaryIntents,
    confidence: vague ? 0.68 : classification.primaryIntent === "project_action" ? 0.62 : 0.9,
    ambiguity: vague ? "low" : classification.primaryIntent === "project_action" ? "material" : "none",
    consequence: impact,
    action: classification.action,
    actionMatched: classification.actionMatched,
    requestsNewProject: classification.requestsNewProject,
    goals: classification.goals,
    target: targetProjectId ? { projectId: targetProjectId } : undefined,
    requirements: {
      needsProject: ["code", "website", "deploy", "debug", "project_action", "mixed"].includes(classification.primaryIntent),
      needsFiles: ["code", "website", "debug", "project_action"].includes(classification.primaryIntent),
      needsApproval: needsApproval({ consequence: impact, primaryIntent: classification.primaryIntent }),
      needsExternalService: ["deploy", "image", "video", "music", "research", "mixed"].includes(classification.primaryIntent),
    },
  };

  if (result.ambiguity === "material" && !hasUsefulContext) {
    return { type: "clarification", request: { question: "What should LiTT work on? Tell me the project, file, asset, or result you want changed." } };
  }
  return { type: "intent", result };
}
