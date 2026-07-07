// LiT-Tip Guide — prompt scanner and cost estimator
// Real-time hints that teach users how to control AI agents and reduce token waste.

export type TipSeverity = "info" | "warning" | "risk" | "success";

export type LiTTip = {
  id: string;
  message: string;
  severity: TipSeverity;
  action?: "fix" | "addStop" | "scope" | "split" | "cheaper" | "explain";
};

export type LiTTipResult = {
  score: number; // 0-100
  risk: "low" | "medium" | "high";
  riskReason: string;
  estimatedCredits: { min: number; max: number };
  cheaperPath?: string;
  recommendedModel?: string;
  missing: string[];
  tips: LiTTip[];
  rewrite?: string;
  metadata: {
    wordCount: number;
    hasRole: boolean;
    hasScope: boolean;
    hasFileTarget: boolean;
    hasStopCondition: boolean;
    hasOutputFormat: boolean;
    hasBudget: boolean;
    agentCount: number;
    modelCost: number;
  };
};

const MODEL_COSTS: Record<string, number> = {
  "gemini-2.5-flash": 0.08,
  "gemini-2.5-pro": 0.8,
  "gemini-2.0-flash": 0.05,
  "llama3.2:3b": 0.0,
  "claude-sonnet-4": 1.5,
  "openrouter/free": 0.0,
  "qwen/qwen-2.5-coder-32b-instruct:free": 0.0,
  "google/gemini-2.5-flash": 0.08,
};

export function scanPrompt(
  prompt: string,
  agent = "director",
  model = "gemini-2.5-flash",
): LiTTipResult {
  const text = prompt.trim();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const charCount = text.length;

  const hasRole = /(role|you are|you're|act as|be a|as a|agent|forge|coder|teacher|designer)/i.test(text);
  const hasScope = /(scope|only|limit|focus|just the|specifically|target|restrict)/i.test(text);
  const hasFileTarget = /(file|files|component|page|folder|path|src\/|app\/|\.tsx|\.ts|\.json|\.css)/i.test(text);
  const hasStopCondition = /(stop|after|maximum|limit|no more than|up to|unless|ask before|confirm)/i.test(text);
  const hasOutputFormat = /(format|output|return|json|markdown|html|code block|triple backticks|list|table)/i.test(text);
  const hasBudget = /(credit|token|budget|cost|cheap|efficient|quick|fast)/i.test(text);
  const agentCount = (text.match(/(agent|forge|pulse|director|visionary|nexus|social-pilot|coder|teacher|reviewer)/gi) || []).length;

  const missing: string[] = [];
  if (!hasRole) missing.push("role");
  if (!hasScope) missing.push("scope");
  if (!hasFileTarget) missing.push("file target");
  if (!hasStopCondition) missing.push("stop condition");
  if (!hasOutputFormat) missing.push("output format");

  const tips: LiTTip[] = [];

  if (!hasRole) {
    tips.push({
      id: "no-role",
      message: "Give the agent a clear role so it knows what job to perform.",
      severity: "warning",
      action: "fix",
    });
  }

  if (!hasScope) {
    tips.push({
      id: "no-scope",
      message: "Add a scope so the agent does not wander into unrelated files or tasks.",
      severity: "warning",
      action: "scope",
    });
  }

  if (!hasFileTarget) {
    tips.push({
      id: "no-files",
      message: "Point to specific files or components. This reduces repeated reads and saves credits.",
      severity: "info",
      action: "scope",
    });
  }

  if (!hasStopCondition) {
    tips.push({
      id: "no-stop",
      message: "Add a stop condition so the agent does not retry forever.",
      severity: "risk",
      action: "addStop",
    });
  }

  if (!hasOutputFormat) {
    tips.push({
      id: "no-format",
      message: "Request a specific output format so you get usable results faster.",
      severity: "info",
      action: "fix",
    });
  }

  if (agentCount > 3) {
    tips.push({
      id: "too-many-agents",
      message: `You referenced ${agentCount} agent-like roles. One focused agent is usually cheaper and clearer.`,
      severity: "warning",
      action: "split",
    });
  }

  if (wordCount > 250 && !hasScope) {
    tips.push({
      id: "long-prompt",
      message: "Your prompt is long and lacks a scope. Summarize or split into steps.",
      severity: "warning",
      action: "split",
    });
  }

  if (wordCount > 0 && wordCount < 8 && !hasOutputFormat) {
    tips.push({
      id: "too-short",
      message: "Very short prompts often lead to vague answers. Add one constraint or format.",
      severity: "info",
      action: "fix",
    });
  }

  if (/(build me|create|make).+(dashboard|app|website|platform|system)/i.test(text) && !hasScope) {
    tips.push({
      id: "broad-task",
      message: "This is a broad task. Pin the scope to one page or component first.",
      severity: "warning",
      action: "scope",
    });
  }

  if (/(run|execute|terminal|command|shell|bash|rm |delete |drop |sudo)/i.test(text) && !hasStopCondition) {
    tips.push({
      id: "risky-command",
      message: "This looks like a command or destructive task. Add a stop condition and require approval.",
      severity: "risk",
      action: "addStop",
    });
  }

  if (!hasBudget && agentCount > 1) {
    tips.push({
      id: "no-budget",
      message: "Multiple agents without a budget can burn credits fast. Consider a single focused agent.",
      severity: "warning",
      action: "cheaper",
    });
  }

  // Score calculation
  let score = 50;
  if (hasRole) score += 15;
  if (hasScope) score += 15;
  if (hasFileTarget) score += 10;
  if (hasStopCondition) score += 15;
  if (hasOutputFormat) score += 10;
  if (hasBudget) score += 5;
  if (wordCount > 250 && !hasScope) score -= 15;
  if (agentCount > 3) score -= 10;
  if (/run|execute|terminal|rm |delete |sudo/i.test(text) && !hasStopCondition) score -= 15;
  if ((agent === "forge" || agent === "code-champion") && hasFileTarget && hasScope) score += 5;
  score = Math.max(0, Math.min(100, score));

  // Risk
  let risk: "low" | "medium" | "high" = "low";
  let riskReason = "Looks focused and bounded.";
  if (score < 40 || (/run|execute|rm |delete |sudo/i.test(text) && !hasStopCondition)) {
    risk = "high";
    riskReason = "Missing guardrails or destructive action without a stop condition.";
  } else if (score < 70 || agentCount > 3 || (wordCount > 250 && !hasScope)) {
    risk = "medium";
    riskReason = "Prompt is broad, vague, or may retry repeatedly.";
  }

  // Cost estimate
  const modelCost = MODEL_COSTS[model] ?? MODEL_COSTS["gemini-2.5-flash"] ?? 0.08;
  const baseTokens = Math.ceil(charCount / 4);
  const outputTokens = Math.min(2048, Math.max(256, wordCount * 4));
  const totalTokens = baseTokens + outputTokens;
  // Rough credit formula: 1 credit ≈ 1000 tokens at flash price
  const creditPer1k = (modelCost / 0.08) * 1;
  const minCredits = Math.max(1, Math.round((totalTokens / 1000) * creditPer1k * 0.5));
  const maxCredits = Math.max(minCredits, Math.round((totalTokens / 1000) * creditPer1k * 1.5));

  let cheaperPath: string | undefined;
  let recommendedModel: string | undefined;
  if (modelCost >= 0.5) {
    cheaperPath = "Use Gemini 2.5 Flash for drafting, then switch to Pro only for final review.";
    recommendedModel = "gemini-2.5-flash";
  } else if (wordCount > 250 && !hasScope) {
    cheaperPath = "Summarize the request into a plan first, then ask for code in a second step.";
  } else if (!hasFileTarget) {
    cheaperPath = "Pin the target files before running so the agent does not read the whole project.";
  } else if (agentCount > 2) {
    cheaperPath = "Use one agent per step instead of loading multiple roles into one prompt.";
  }

  if (score >= 85) {
    tips.push({
      id: "good-prompt",
      message: "Prompt is well-structured. Good role, scope, and boundaries.",
      severity: "success",
    });
  }

  return {
    score,
    risk,
    riskReason,
    estimatedCredits: { min: minCredits, max: maxCredits },
    cheaperPath,
    recommendedModel,
    missing,
    tips,
    metadata: {
      wordCount,
      hasRole,
      hasScope,
      hasFileTarget,
      hasStopCondition,
      hasOutputFormat,
      hasBudget,
      agentCount,
      modelCost,
    },
  };
}

export function suggestPromptRewrite(prompt: string, missing: string[]): string {
  const text = prompt.trim();
  if (!text) return text;

  const additions: string[] = [];
  if (missing.includes("role")) additions.push("Role: act as a senior developer");
  if (missing.includes("scope")) additions.push("Scope: only edit the requested files");
  if (missing.includes("file target")) additions.push("Files: target these files");
  if (missing.includes("stop condition")) additions.push("Stop condition: stop after one attempt and ask before continuing");
  if (missing.includes("output format")) additions.push("Output format: return code in markdown code blocks");

  if (!additions.length) return text;

  return `${text}\n\n---\n${additions.map((a) => `- ${a}`).join("\n")}`;
}
