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

function intentForPrompt(prompt: string, context: RouterInput["context"]): {
  primaryIntent: LiTTIntent;
  secondaryIntents: LiTTIntent[];
  action: ActionVerb;
  goals: string[];
} {
  const intents: LiTTIntent[] = [];
  const add = (intent: LiTTIntent) => {
    if (!intents.includes(intent)) intents.push(intent);
  };
  const action: ActionVerb = (context.selectedAssetId && has(prompt, /\b(darker|lighter|edit|change|update|redesign|restyle|modify|variation)\b/i))
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
            : has(prompt, /\b(generate|make|create|build|write)\b/i)
              ? "generate"
              : "create";

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

  // Conversational messages (greetings, general questions) are not project
  // actions — without this they fall through to "project_action" with
  // material ambiguity and get clarification-blocked even though there is
  // nothing to clarify. Chat passes straight to the model.
  const isConversational =
    intents.length === 0 &&
    (/\?\s*$/.test(prompt) ||
      /^(hello|hi|hey|yo|good (morning|afternoon|evening)|thanks|thank you|what is|what are|what's|who is|who's|how (do|does|can|to|about)|why|when|where|which|can you|could you|do you|are you|is there|tell me about|explain)\b/i.test(
        prompt,
      ));

  const primaryIntent = isConversational ? "chat" : intents[0] ?? "project_action";
  const secondaryIntents = intents.slice(1);
  const finalPrimary = intents.length > 1 ? "mixed" : primaryIntent;
  return {
    primaryIntent: finalPrimary,
    secondaryIntents,
    action,
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
