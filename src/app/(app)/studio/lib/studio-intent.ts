import type { InspectorTab, StudioTool } from "./studio-destinations";

export type StudioIntent =
  | "chat"
  | "generate_code"
  | "generate_image"
  | "generate_video"
  | "open_terminal"
  | "run_command"
  | "connect_github"
  | "start_blank_project"
  | "open_files"
  | "file_question"
  | "open_preview"
  | "visual_output"
  | "project_health"
  | "open_approvals"
  | "open_settings"
  | "unknown";

export interface IntentResult {
  intent: StudioIntent;
  tool?: StudioTool;
  message: string;
  actions?: Array<{ label: string; action: string }>;
  /**
   * The user's original message text. Carried so a handler can prefill a
   * real surface with it (P1-1: the image intent opens the Image Studio
   * with the prompt prefilled — the request must survive the routing).
   */
  prompt?: string;
}

// Navigation shortcuts must never intercept a request that describes a
// mutation. A request can mention both an edit and a preview (for example,
// "change the hero text and refresh the preview"); that is still an agent
// request, not a request to open the Preview panel.
const MUTATION_VERB = /\b(modif(?:y|ication)|change|edit|update|rewrite|replace|remove|delete|add|create|build|deploy|publish)\b/i;
const MUTATION_TARGET = /\b(file|content|text|paragraph|code|project|site|page|hero|section|button|component|approval|diff)\b/i;

export function extractMediaPrompt(input: string, media: "image" | "video"): string {
  const text = input.trim();
  if (media === "video") {
    return (
      text
        .replace(/^turn\s+(.+?)\s+into\s+(?:a|an|the)?\s*(?:video|clip)\s*$/i, "$1")
        .replace(/^(?:please\s+)?(?:generate|create|make)\s+(?:(?:me|us)\s+)?(?:(?:a|an|the)\s+)?/i, "")
        .replace(/^animate\s+/i, "")
        .trim() || text
    );
  }
  return text
    .replace(/^(?:please\s+)?(?:generate|create|make)\s+(?:(?:me|us)\s+)?(?:(?:a|an|the)\s+)?(?:image|wallpaper)\s*(?:of\s+|about\s+|showing\s+)?/i, "")
    .trim() || text;
}

export function isLikelyMutationRequest(input: string): boolean {
  const text = input.trim();
  return MUTATION_VERB.test(text) && MUTATION_TARGET.test(text);
}

interface IntentPattern {
  intent: StudioIntent;
  patterns: RegExp[];
  tool?: StudioTool;
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    intent: "open_terminal",
    tool: "terminal",
    patterns: [
      /^(make|open|show|start|launch|give)\b.*\bterminal\b/i,
      /\bopen\b.*\bterminal\b/i,
      /\bshow\b.*\bterminal\b/i,
      /\bstart\b.*\bterminal\b/i,
      /\blaunch\b.*\bterminal\b/i,
      /\bgive\b.*\bterminal\b/i,
      /^terminal$/i,
    ],
  },
  {
    intent: "file_question",
    patterns: [
      // Only intercept explicit "open the files panel" requests.
      // Questions about files/structure go to the LLM which now has
      // real file listing and reading from the agent loop.
      /^(open|show|view|go to|read)\b.*\b(files?|file tree|file explorer|component file)\b/i,
    ],
  },
  {
    intent: "open_files",
    tool: "code",
    patterns: [
      /^(open|show|view)\b.*\bfiles?\b/i,
      /\bshow\b.*\bfile tree\b/i,
      /\bopen\b.*\bfile explorer\b/i,
    ],
  },
  {
    intent: "visual_output",
    patterns: [
      /\b(show|open|view|render|inspect)\b.*\b(visual|rendered|ui)\b/i,
      /\bwhat does it look like\b/i,
    ],
  },
  {
    intent: "open_preview",
    tool: "build",
    patterns: [
      /^(open|show|view|launch)\b.*\bpreview\b/i,
      /\bshow\b.*\bpreview\b/i,
    ],
  },
  {
    intent: "project_health",
    patterns: [
      // Only intercept explicit "open the health panel" requests.
      // General health/lint/test questions go to the LLM which now has
      // real auto-inspection data from the agent loop.
      /^(open|show|view|go to|run)\b.*\b(project health|quality checks?|health panel|health checks?)\b/i,
    ],
  },
  {
    intent: "open_approvals",
    patterns: [
      /\b(show|open|view|check|review)\b.*\bapprovals?\b/i,
      /\bwhat needs approval\b/i,
    ],
  },
  {
    intent: "connect_github",
    patterns: [
      /^(connect|link)\b.*\bgithub\b/i,
      /\binstall\b.*\bgithub\b/i,
      /\bconnect\b.*\brepo\b/i,
    ],
  },
  {
    intent: "start_blank_project",
    patterns: [
      /\bstart\b.*\bblank\b.*\bproject\b/i,
      /\bnew\b.*\bblank\b.*\bproject\b/i,
      /\bcreate\b.*\bblank\b.*\bproject\b/i,
    ],
  },
  {
    intent: "open_settings",
    patterns: [
      /^(open|show|go to)\b.*\bsettings\b/i,
    ],
  },
  {
    intent: "run_command",
    patterns: [
      /^run\b\s+\S/i,
    ],
  },
  {
    intent: "generate_video",
    tool: "video",
    patterns: [
      /\b(?:generate|create|make)\s+(?:(?:me|us)\s+)?(?:(?:a|an|the)\s+)?(?:(?:\d+(?:\.\d+)?\s*(?:seconds?|secs?|s)\s+)?(?:short|cinematic|photorealistic|animated)\s+)?(?:video|clip)\b/i,
      /\banimate\s+(?:this|that|it|the|an?|my)\b/i,
      /\bturn\s+(?:this|that|it|an?|the|my)\b.*\b(?:video|clip)\b/i,
      /\b(?:short|cinematic)\s+(?:video|clip)\b/i,
    ],
  },
  {
    intent: "generate_image",
    tool: "image",
    patterns: [
      /\bgenerate?\b.*\bimage\b/i,
      /\bcreate\b.*\bimage\b/i,
      /\bmake\b.*\bimage\b/i,
      /\bgenerate?\b.*\bwallpaper\b/i,
      /\bcreate\b.*\bwallpaper\b/i,
    ],
  },
  {
    intent: "generate_code",
    patterns: [
      /\bbuild\b.*\b(terminal|component|widget|app|website|page|form|dashboard|interface|ui)\b/i,
      /\bcreate\b.*\b(terminal|component|widget|app|website|page|form|dashboard|interface|ui)\b/i,
      /\bgenerate\b.*\b(code|component|widget|app|website|page|form|dashboard|interface|ui)\b/i,
      /\bmake\b.*\b(terminal|component|widget|app|website|page|form|dashboard|interface|ui)\b/i,
      /\bcode\b.*\bfor\b/i,
    ],
  },
];

export function detectIntent(input: string): IntentResult | null {
  const text = input.trim();
  if (!text) return null;

  const generateCode = INTENT_PATTERNS.find(({ intent }) => intent === "generate_code");
  if (generateCode?.patterns.some((pattern) => pattern.test(text))) {
    return buildIntentResult(generateCode.intent, generateCode.tool, text);
  }

  if (isLikelyMutationRequest(text)) return null;

  for (const { intent, patterns, tool } of INTENT_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        return buildIntentResult(intent, tool, text);
      }
    }
  }

  return null;
}

function buildIntentResult(
  intent: StudioIntent,
  tool: StudioTool | undefined,
  originalText: string,
): IntentResult | null {
  switch (intent) {
    case "open_terminal":
      return {
        intent,
        tool,
        message: "Opening Terminal.",
        actions: [
          { label: "Connect GitHub", action: "connect_github" },
          { label: "Start Blank Project", action: "start_blank_project" },
          { label: "Retry Terminal", action: "retry_terminal" },
        ],
      };
    case "file_question":
      return { intent, message: "Opening Files." };
    case "open_files":
      return { intent, tool, message: "Opening Files." };
    case "visual_output":
      return { intent, message: "Opening Preview." };
    case "open_preview":
      return { intent, tool, message: "Opening Preview." };
    case "project_health":
      return {
        intent,
        message: "Opening the Project Health panel.",
        actions: [
          { label: "View results", action: "view_health" },
        ],
      };
    case "open_approvals":
      return { intent, message: "Opening Approvals." };
    case "connect_github":
      return {
        intent,
        message: "Connecting GitHub. Redirecting to GitHub App installation...",
        actions: [{ label: "Connect GitHub", action: "connect_github" }],
      };
    case "start_blank_project":
      return {
        intent,
        message: "Opening the new-project dialog.",
      };
    case "open_settings":
      return { intent, message: "Opening Settings." };
    case "run_command":
      return {
        intent,
        tool: "terminal",
        message: "Opening Terminal to run that command.",
      };
    case "generate_image":
      return { intent, tool, message: "", prompt: originalText };
    case "generate_video":
      return { intent, tool, message: "", prompt: extractMediaPrompt(originalText, "video") };
    case "generate_code":
      return { intent, message: "" };
    default:
      return null;
  }
}

export interface StudioIntentHandlers {
  onRouteToolAction?: (tool: StudioTool) => void;
  onRouteInspectorAction?: (tab: InspectorTab) => void;
  /** Triggered when LiTT should run all project health checks */
  onRunHealthChecks?: () => void;
  /** Triggered when LiTT should open the new-project name dialog */
  onOpenProjectNameDialog?: () => void;
  /** Triggered when LiTT should navigate the browser (settings, GitHub install) */
  onNavigate?: (url: string) => void;
  /**
   * P1-1: open the REAL Image Studio surface with the user's prompt
   * prefilled. This is the only honest handler for generate_image —
   * routing through onRouteToolAction("image") normalizes to the chat
   * surface (a placeholder + Media tab) and never generates anything.
   */
  onOpenImageStudio?: (prompt: string) => void;
  /** Open the real Video Studio surface with the prompt prefilled. */
  onOpenVideoStudio?: (prompt: string) => void;
}

/**
 * Route a detected studio intent to its real surface.
 *
 * Hard rule (P1-1): every intent that produces a confirmation message MUST
 * trigger a real action here. A confirmation message with no matching
 * action is a dead flow — the chat claims something opened while nothing
 * happens.
 */
export function dispatchStudioIntent(
  intent: IntentResult,
  handlers: StudioIntentHandlers,
): void {
  if (intent.intent === "generate_image") {
    // P1-1: the chat tells the user "Opening the image generator." — so
    // the REAL Image Studio must actually open, with the user's prompt
    // prefilled. Deliberately NOT routed through onRouteToolAction: the
    // legacy "image" tool id normalizes to the chat surface (composer
    // placeholder + Media tab), which is the dead flow this replaces.
    // The prompt travels on the intent so the request survives routing.
    handlers.onOpenImageStudio?.(intent.prompt ?? "");
    return;
  }
  if (intent.intent === "generate_video") {
    handlers.onOpenVideoStudio?.(intent.prompt ?? "");
    return;
  }
  if (intent.intent === "open_files" || intent.intent === "file_question") {
    handlers.onRouteInspectorAction?.("files");
  } else if (intent.intent === "open_preview" || intent.intent === "visual_output") {
    handlers.onRouteInspectorAction?.("preview");
  } else if (intent.intent === "project_health") {
    handlers.onRouteInspectorAction?.("checks");
    // Trigger real check execution — not just panel navigation
    handlers.onRunHealthChecks?.();
  } else if (intent.intent === "open_approvals") {
    handlers.onRouteInspectorAction?.("approvals");
  } else if (intent.intent === "start_blank_project") {
    // Real blank-project flow — opens the project-name dialog
    handlers.onOpenProjectNameDialog?.();
  } else if (intent.tool) {
    handlers.onRouteToolAction?.(intent.tool);
  }
  if (intent.intent === "connect_github") {
    handlers.onNavigate?.("/api/github/install");
  }
  if (intent.intent === "open_settings") {
    handlers.onNavigate?.("/settings");
  }
}

/**
 * Assistant copy for a handled intent. Must describe what dispatchStudioIntent
 * actually did — never promise an action that was not taken.
 */
export function buildIntentResponseMessage(
  intent: IntentResult,
  runtime: { terminalConnected: boolean },
): string {
  if (intent.intent === "open_terminal") {
    return runtime.terminalConnected
      ? "Opening Terminal."
      : "The terminal is not connected yet. Use Workspace status → Open Terminal & Connect when you want to start it.";
  }
  if (intent.intent === "connect_github") {
    return "Connecting GitHub. Redirecting to GitHub App installation...";
  }
  if (intent.intent === "start_blank_project") {
    return "Opening the new-project dialog.";
  }
  if (intent.intent === "run_command") {
    return "Opening Terminal to run that command.";
  }
  if (intent.intent === "generate_image") {
    return "Opening the image generator.";
  }
  if (intent.intent === "generate_video") {
    return "Opening the video generator.";
  }
  if (intent.intent === "project_health") {
    return runtime.terminalConnected
      ? "I'm running a complete project health check now — TypeScript, lint, tests, build, and security audit. Results will appear in the Project Health panel."
      : "I'll run a complete project health check. The workspace is being resolved — results will stream into the Project Health panel once the terminal connects.";
  }
  return intent.message || "Done.";
}
