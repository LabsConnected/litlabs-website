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

// Prepositions between the signal word(s) and the deliverable mean the
// deliverable is the TARGET of other work, not the thing being created:
// "new component for my app", "changes to the site", "image for my
// website". Possessives/determiners are excluded the same way — "new
// logo for my website", "make my website better" target an existing
// project, never a new one.
const PREP_GAP = "on\\b|to\\b|into\\b|in\\b|inside\\b|within\\b|for\\b|of\\b|with\\b|about\\b|at\\b";
const DETERMINER_GAP = "the\\b|this\\b|that\\b|these\\b|those\\b|my\\b|your\\b|our\\b|their\\b|existing\\b|current\\b";

const NEW_PROJECT_PATTERNS = [
  // "new <deliverable>": "a new website", "new app", "my new project".
  // The gap allows only adjectives — no prepositions and no determiners,
  // so "new component for my app" and "new feature in my app" fail.
  new RegExp(
    `\\bnew\\s+(?:(?!${PREP_GAP}|${DETERMINER_GAP}|a\\b|an\\b)[\\w-]+\\s+){0,3}${PROJECT_DELIVERABLE}\\b`,
    "i",
  ),
  // A creation verb governing a project deliverable: "create a website",
  // "build me an app", "spin up a landing page". The indefinite article
  // and "new" stay allowed ("create a website", "build a new app");
  // prepositions and possessives/determiners do not.
  new RegExp(
    `\\b(?:create|build|make|scaffold|generate|develop|spin\\s+up|set\\s+up(?=\\s+(?:a|an|new)\\b)|start(?=\\s+(?:a|an|new)\\b))\\b\\s+(?:me\\s+|us\\s+)?` +
      `(?:(?!${PREP_GAP}|${DETERMINER_GAP})[\\w-]+\\s+){0,4}` +
      `${PROJECT_DELIVERABLE}\\b`,
    "i",
  ),
];

/**
 * Question and instruction frames — the prompt asks ABOUT creation, it
 * does not command it. "Tell me how to build a new app", "Explain how to
 * create a project", "Should I build a website?" all carry matching
 * creation phrases but are chat requests. Direct commands phrased
 * politely ("can you build me a website", "help me create a site") keep
 * their signal — "can you"/"help me" are requests, not questions.
 */
const DISCUSSION_FRAME = new RegExp(
  "\\b(?:" +
    "how\\s+to\\b|" +
    "how\\s+(?:do|does|did|can|could|should|would|might|may)\\b|" +
    "what(?:'s|\\s+is|\\s+are|\\s+was|\\s+were|\\s+does|\\s+do|\\s+did|\\s+would|\\s+should)\\b|" +
    "why\\s+(?:should|would|could|do|does|did|is|are|was|were)\\b|" +
    "tell\\s+me\\b|" +
    "explain\\b|" +
    "describe\\b|" +
    "teach\\s+me\\b|" +
    "show\\s+me\\b|" +
    "walk\\s+me\\b|" +
    "should\\s+i\\b|" +
    "could\\s+i\\b|" +
    "do\\s+i\\s+need\\b|" +
    "difference\\s+between\\b|" +
    "steps?\\s+to\\b|" +
    "guide\\s+(?:me|through|on)\\b|" +
    "tutorial\\b|" +
    "learn\\s+(?:how|to)\\b" +
    ")",
  "i",
);

/**
 * True only for an unambiguous new-project request. Questions,
 * instructions about building, comparisons, file-scope artifacts, and
 * work on an existing project all return false — the caller must fail
 * closed.
 */
function promptRequestsNewProject(prompt: string): boolean {
  if (DISCUSSION_FRAME.test(prompt)) return false;
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
