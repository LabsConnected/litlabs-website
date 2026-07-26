import type { StudioTool } from "../components/StudioSidebar";

export type StudioIntent =
  | "chat"
  | "generate_code"
  | "generate_image"
  | "open_terminal"
  | "run_command"
  | "connect_github"
  | "start_blank_project"
  | "open_files"
  | "open_preview"
  | "deploy"
  | "open_settings"
  | "unknown";

export interface IntentResult {
  intent: StudioIntent;
  tool?: StudioTool;
  message: string;
  actions?: Array<{ label: string; action: string }>;
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
    intent: "open_files",
    tool: "code",
    patterns: [
      /^(open|show|view)\b.*\bfiles?\b/i,
      /\bshow\b.*\bfile tree\b/i,
      /\bopen\b.*\bfile explorer\b/i,
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
    intent: "deploy",
    patterns: [
      /\bdeploy\b.*\bproject\b/i,
      /\bdeploy\b.*\bapp\b/i,
      /\bdeploy\b.*\bsite\b/i,
      /^deploy$/i,
    ],
  },
  {
    intent: "run_command",
    patterns: [
      /\brun\b.*\bgit\b/i,
      /\brun\b.*\bnpm\b/i,
      /\brun\b.*\bpnpm\b/i,
      /\brun\b.*\byarn\b/i,
      /\brun\b.*\bcommand\b/i,
      /\bexecute\b.*\bcommand\b/i,
    ],
  },
  {
    intent: "generate_image",
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
  _originalText: string,
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
    case "open_files":
      return { intent, tool, message: "Opening Files." };
    case "open_preview":
      return { intent, tool, message: "Opening Preview." };
    case "connect_github":
      return {
        intent,
        message: "Connecting GitHub. Redirecting to GitHub App installation...",
        actions: [{ label: "Connect GitHub", action: "connect_github" }],
      };
    case "start_blank_project":
      return {
        intent,
        message: "Starting a blank project. Workspace will be ready in a moment.",
      };
    case "open_settings":
      return { intent, message: "Opening Settings." };
    case "deploy":
      return { intent, message: "Preparing deployment." };
    case "run_command":
      return {
        intent,
        tool: "terminal",
        message: "Opening Terminal to run that command.",
      };
    case "generate_image":
      return {
        intent,
        tool: "image",
        message: "Opening the image generator.",
      };
    case "generate_code":
      return { intent, message: "" };
    default:
      return null;
  }
}
