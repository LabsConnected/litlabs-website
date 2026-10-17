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
  // The lookbehind goes further: "new" preceded by a possessive/definite
  // determiner or a preposition names an EXISTING thing ("my new app",
  // "the new website", "for my new app"), not a creation request. The
  // indefinite article stays allowed — "a new app" is still an ask.
  new RegExp(
    `(?<!(?:my|your|our|their|the|this|that|these|those|existing|current|for|to|into|in|on|onto|inside|within|of|with|about|at|from|by)\\s)` +
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

// Conversation openers that carry no semantic load — a cue after them
// still frames the whole prompt ("okay, tell me how to build an app").
const OPENING_FILLER = "(?:so|ok|okay|hey|hi|hello|now|well|um|uh|please|actually|just)[,!.]?\\s+";

/**
 * Question and instruction frames — START-anchored (after optional
 * filler). A prompt that opens by asking about creation ("Tell me how
 * to build a new app", "Should I build a website?", "Is it possible to
 * create a project") is a chat request, not a creation command. The
 * cues are anchored so a legitimate request is never vetoed because its
 * job description merely contains "tutorial", "describe", or "what is"
 * ("build me a site with a tutorial section" stays a build).
 */
const DISCUSSION_FRAME = new RegExp(
  `^\\s*(?:${OPENING_FILLER})*(?:` +
    "how\\b|" +
    "what(?:'s)?\\b|" +
    "why\\b|" +
    "where\\b|" +
    "when\\b|" +
    "who\\b|" +
    "which\\b|" +
    "is\\b|" +
    "are\\b|" +
    "does\\b|" +
    "would\\b|" +
    "will\\b|" +
    "am\\s+i\\b|" +
    "i\\s+wonder\\b|" +
    // "I'm wondering if…", "I was wondering whether…" — deliberation, not
    // a command.
    "i(?:'m|\\s+am|\\s+was)\\s+wondering\\b|" +
    "wondering\\s+(?:if|whether)\\b|" +
    "do\\s+(?:i|you)\\b|" +
    "should\\s+i\\b|" +
    "could\\s+i\\b|" +
    // "can I build…" asks permission; "can you build…" stays a command.
    "can\\s+(?:i|we)\\b|" +
    "could\\s+we\\b|" +
    // A modal-you opener followed by an INFORMATION verb is a question
    // about the work ("could you explain how to create a site"), not the
    // work itself. "help me" only counts when it governs an understanding
    // verb — "can you help me create a website" is still a command.
    "(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?(?:explain|tell|show|describe|teach|walk|guide|outline|list|compare|recommend|suggest|advise|give\\s+me|help\\s+me\\s+(?:understand|learn|figure\\s+out|decide|choose|pick))\\b|" +
    "tell\\s+me\\b|" +
    "explain\\b|" +
    "describe\\b|" +
    "teach\\s+me\\b|" +
    "show\\s+me\\b|" +
    "walk\\s+me\\b|" +
    // "help me understand/learn/know…" asks for comprehension; "help me
    // create a website" stays a command because "create" is not listed.
    "help\\s+me\\s+(?:understand|learn|figure\\s+out|know|see|hear|decide|choose|pick)\\b|" +
    // Information-seeking imperatives — "give me steps to build a
    // website", "recommend a stack for a new app" — ask for guidance,
    // not for the artifact.
    "give\\s+me\\s+(?:(?:the|some|a|an)\\s+)?(?:steps?|instructions?|directions?|guidance|advice|tips?|ideas?|recommendations?|suggestions?|tutorial|guide|walkthrough|breakdown|rundown|recipe|checklist|overview|plan|pointers?)\\b|" +
    "(?:recommend|suggest|advise)\\b|" +
    "any\\s+(?:idea|ideas|way|chance|luck|tips?|suggestions?|recommendations?|thoughts?|advice|pointers?|clues?)\\b|" +
    "(?:anyone|anybody)\\s+know\\b|" +
    // Deliberation openers — "I think I should build an app, what do you
    // think", "I want to know how to build an app".
    "i\\s+(?:think|believe|feel)\\b|" +
    "i\\s+(?:want|need)\\s+to\\s+(?:know|understand|learn|figure\\s+out|find\\s+out|ask|hear|see)\\b|" +
    "i(?:'d|\\s+would)\\s+like\\s+to\\s+(?:know|understand|learn|hear)\\b|" +
    "difference\\s+between\\b|" +
    "steps?\\s+to\\b|" +
    "guide\\s+(?:me|through|on)\\b|" +
    "tutorial\\b|" +
    "learn\\s+(?:how|to)\\b" +
    ")",
  "i",
);

/**
 * A trailing "?" usually means the prompt is ASKING, not commanding —
 * "build me a website?" is chat until proven otherwise. Exception: a
 * prompt that clearly opens with a direct polite command naming a
 * creation verb ("can you build me a website?", "please create a
 * site?") — the mark is courtesy, not a question about whether/how.
 * "can you tell me how to build an app?" still vetoes — "tell" is not
 * a creation verb.
 */
const POLITE_COMMAND = new RegExp(
  `^\\s*(?:${OPENING_FILLER})*` +
    "(?:(?:can|could)\\s+you\\s+(?:please\\s+)?|please\\s+)" +
    "(?:create|build|make|scaffold|generate|develop|spin\\s+up|set\\s+up|start)\\b",
  "i",
);

/**
 * Media/design generation nouns grouped by the intent they produce —
 * media-detection and intent-classification share this split so a real
 * media request always carries the matching intent ("compose a jingle"
 * is a music request even though "jingle" is not a keyword intent).
 */
const IMAGE_NOUN = "(?:image|logo|artwork|illustration|picture|photos?|graphic|banner|thumbnail|icon)";
const VIDEO_NOUN = "(?:video|clip|animation)";
const MUSIC_NOUN = "(?:song|music|soundtrack|beat|track|audio|jingle|voiceover|podcast|melody|tune)";
const DESIGN_NOUN = "(?:design|wireframe|mockup|palette)";
const MEDIA_NOUN = `(?:${IMAGE_NOUN}|${VIDEO_NOUN}|${MUSIC_NOUN}|${DESIGN_NOUN})`;

const MEDIA_INTENT_SET: ReadonlySet<LiTTIntent> = new Set(["image", "video", "music", "design"]);

/**
 * Software-artifact head nouns. "music player", "image gallery", "song
 * parser", "clip scheduler", "beat tracker", "design system" name a
 * SOFTWARE deliverable — the media word modifies the artifact. A media
 * noun followed by one of these is software development involving media,
 * never a media-generation request.
 */
const SOFTWARE_ARTIFACT =
  "(?:player|gallery|parser|scheduler|tracker|pipeline|library|tool|system|editor|generator|viewer|maker|builder|manager|component|widget|plugin|server|client|dashboard|platform|engine|framework|app|application|site|website|module|service|monitor|analy[sz]er|visuali[sz]er|uploader|downloader|converter|scraper|crawler|bot|cli|api|sdk|compiler|linter|debugger|profiler|emulator|runtime|worker|mixer|sequencer|synthesizer|sampler|recorder|studio|browser|explorer|store|panel)";

const MEDIA_REQUEST = new RegExp(
  `\\b(?:create|make|build|generate|produce|design|draw|paint|sketch|illustrate|render|compose|write|record|spin\\s+up)\\b\\s+(?:me\\s+|us\\s+)?` +
    `(?:(?!${PREP_GAP}|${DETERMINER_GAP})[\\w-]+\\s+){0,4}` +
    `(${MEDIA_NOUN})\\b(?!\\s+${SOFTWARE_ARTIFACT}\\b)`,
  "i",
);

/**
 * draw / paint / sketch / illustrate produce an IMAGE whatever the
 * subject — "draw a dragon" is an image request even though "dragon" is
 * not a media noun. The object just can't be a software artifact or a
 * project deliverable ("sketch a parser", "draw a new site" stay work).
 */
const VISUAL_ART_REQUEST = new RegExp(
  `\\b(?:draw|paint|sketch|illustrate)\\b\\s+(?:me\\s+|us\\s+)?` +
    `(?:(?!${PREP_GAP}|${DETERMINER_GAP})[\\w-]+\\s+){0,4}` +
    `(?!${SOFTWARE_ARTIFACT}\\b|${PROJECT_DELIVERABLE}\\b|${PREP_GAP}|${DETERMINER_GAP})[\\w-]+\\b` +
    `(?!\\s+${SOFTWARE_ARTIFACT}\\b)`,
  "i",
);

/**
 * A project noun bound by a destination qualifier — "a video FOR my new
 * app", "a jingle for the website" — names where the media asset lands,
 * not a second deliverable. Masked before re-detecting scope intents so
 * a standalone media request with project context still reaches its
 * creator. Only standalone media (video, music) get this treatment: an
 * image/design asset destined for a site is part of that site ("an
 * image for my website" is project work and stays in chat).
 */
const PROJECT_DESTINATION = new RegExp(
  `\\b(?:for|to|into|in|on|onto|inside|within|of|from)\\s+` +
    `(?:my|your|our|their|the|a|an|this|that|these|those|existing|current|new)\\b` +
    `(?:\\s+[\\w-]+){0,3}\\s+${PROJECT_DELIVERABLE}\\b`,
  "gi",
);

const MEDIA_NOUN_INTENT: ReadonlyArray<[LiTTIntent, RegExp]> = [
  ["image", new RegExp(`^${IMAGE_NOUN}$`, "i")],
  ["video", new RegExp(`^${VIDEO_NOUN}$`, "i")],
  ["music", new RegExp(`^${MUSIC_NOUN}$`, "i")],
  ["design", new RegExp(`^${DESIGN_NOUN}$`, "i")],
];

function mediaNounIntent(noun: string): LiTTIntent {
  for (const [intent, pattern] of MEDIA_NOUN_INTENT) {
    if (pattern.test(noun)) return intent;
  }
  return "image";
}

/**
 * The intent of the media deliverable a generation verb governs, or null
 * when the prompt is not a media-generation request. "make a music
 * player" returns null — the artifact lookahead rejects it; "draw a
 * dragon" returns "image" through the visual-art rule.
 */
function mediaDeliverableFor(prompt: string): LiTTIntent | null {
  const mediaMatch = MEDIA_REQUEST.exec(prompt);
  if (mediaMatch) return mediaNounIntent(mediaMatch[1]);
  if (VISUAL_ART_REQUEST.test(prompt)) return "image";
  return null;
}

/**
 * Shared vetoes for both request signals — a question or instruction
 * frame, or a prompt ending in "?" that doesn't open with a direct
 * polite creation command, is chat, never a creation request.
 */
function isDiscussion(prompt: string): boolean {
  if (DISCUSSION_FRAME.test(prompt)) return true;
  return prompt.trimEnd().endsWith("?") && !POLITE_COMMAND.test(prompt);
}

/**
 * True only for an unambiguous new-project request. Questions,
 * instructions about building, comparisons, file-scope artifacts, and
 * work on an existing project all return false — the caller must fail
 * closed.
 */
function promptRequestsNewProject(prompt: string): boolean {
  if (isDiscussion(prompt)) return false;
  return NEW_PROJECT_PATTERNS.some((pattern) => pattern.test(prompt));
}

/**
 * The deliverable intent of an unambiguous media/design-generation
 * request, or null. The same fail-closed vetoes apply — asking how to
 * make a logo is chat.
 */
function mediaDeliverableRequested(prompt: string): LiTTIntent | null {
  if (isDiscussion(prompt)) return null;
  return mediaDeliverableFor(prompt);
}

function detectKeywordIntents(prompt: string): LiTTIntent[] {
  const intents: LiTTIntent[] = [];
  const add = (intent: LiTTIntent) => {
    if (!intents.includes(intent)) intents.push(intent);
  };

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

  return intents;
}

function intentForPrompt(prompt: string, context: RouterInput["context"]): {
  primaryIntent: LiTTIntent;
  secondaryIntents: LiTTIntent[];
  intents: LiTTIntent[];
  action: ActionVerb;
  actionMatched: boolean;
  requestsNewProject: boolean;
  requestsMediaGeneration: boolean;
  mediaScopeIntents?: LiTTIntent[];
  goals: string[];
} {
  const intents = detectKeywordIntents(prompt);
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
            : has(prompt, /\b(generate|make|build|write|design|draw|paint|render|compose|produce|record)\b/i)
              ? "generate"
              : has(prompt, /\b(create|scaffold|spin\s*up|set\s*up|start\s+(?=a\s|an\s|new\s))/i)
                ? "create"
                : null;

  if (intents.length === 0 && context.recentIntents?.[0] && has(prompt, /\b(another|again|same|that)\b/i)) {
    intents.push(context.recentIntents[0]);
  }

  // Media harmonization: a real media request always carries a media
  // intent — the governed noun supplies it when no keyword matched
  // ("compose a jingle" → music, "create a banner" → image) and the
  // generative verb supplies it when the subject is arbitrary ("draw a
  // dragon" → image). Only fills the gap; keyword-detected media intents
  // win ("a thumbnail for my video" stays video, not image).
  const mediaDeliverable = mediaDeliverableRequested(prompt);
  if (mediaDeliverable && !intents.some((intent) => MEDIA_INTENT_SET.has(intent))) {
    intents.push(mediaDeliverable);
  }

  // A standalone media deliverable (video, music) bound to a project via
  // a destination qualifier — "a video for my new app" — is media work
  // with project context, not mixed work. Mask the qualifier and
  // re-detect: if what remains is media-only the routing layer can send
  // it to the creator; conjunct deliverables ("a video AND a website")
  // survive masking and still fail closed. Image/design deliverables are
  // never masked — they are part of the project they land in ("an image
  // for my website" is project work, not a bare creator request).
  let mediaScopeIntents: LiTTIntent[] | undefined;
  if (mediaDeliverable === "video" || mediaDeliverable === "music") {
    const masked = prompt.replace(PROJECT_DESTINATION, " ");
    if (masked !== prompt) {
      const scope = detectKeywordIntents(masked);
      if (!scope.some((intent) => MEDIA_INTENT_SET.has(intent))) scope.push(mediaDeliverable);
      mediaScopeIntents = scope;
    }
  }

  const primaryIntent = intents[0] ?? "project_action";
  const secondaryIntents = intents.slice(1);
  const finalPrimary = intents.length > 1 ? "mixed" : primaryIntent;
  return {
    primaryIntent: finalPrimary,
    secondaryIntents,
    intents: [...intents],
    action: matchedAction ?? "create",
    actionMatched: matchedAction !== null,
    requestsNewProject: promptRequestsNewProject(prompt),
    requestsMediaGeneration: mediaDeliverable !== null,
    mediaScopeIntents,
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
    intents: classification.intents,
    confidence: vague ? 0.68 : classification.primaryIntent === "project_action" ? 0.62 : 0.9,
    ambiguity: vague ? "low" : classification.primaryIntent === "project_action" ? "material" : "none",
    consequence: impact,
    action: classification.action,
    actionMatched: classification.actionMatched,
    requestsNewProject: classification.requestsNewProject,
    requestsMediaGeneration: classification.requestsMediaGeneration,
    mediaScopeIntents: classification.mediaScopeIntents,
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
