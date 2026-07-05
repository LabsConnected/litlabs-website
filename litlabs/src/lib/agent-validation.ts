export const REQUIRED_INPUT_KEYS = ["prompt", "context", "agentSlug"] as const;

export type AgentTaskInput = Record<string, unknown>;

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateAgentTaskInput(
  input: AgentTaskInput,
): ValidationResult {
  const errors: string[] = [];

  if (!input || typeof input !== "object") {
    errors.push("Input must be a non-null object");
    return { ok: false, errors };
  }

  for (const key of REQUIRED_INPUT_KEYS) {
    if (
      !(key in input) ||
      input[key] === undefined ||
      input[key] === null ||
      input[key] === ""
    ) {
      errors.push(`Missing required field: ${key}`);
    }
  }

  if (typeof input.prompt === "string" && input.prompt.trim().length < 4) {
    errors.push("Prompt must be at least 4 characters");
  }

  if (
    typeof input.agentSlug === "string" &&
    !/^[a-z0-9-]+$/i.test(input.agentSlug)
  ) {
    errors.push("agentSlug must match ^[a-z0-9-]+$");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export const BLOCKED_PATTERNS = [
  /\b(rm\s+-rf|delete\s+database|drop\s+table)\b/i,
  /\b(sudo\s+rm|mkfs|format\s+c:)\b/i,
] as const;

export function checkPromptSafety(prompt: string): {
  ok: boolean;
  reason?: string;
} {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(prompt)) {
      return {
        ok: false,
        reason: "Prompt contains blocked instruction pattern",
      };
    }
  }

  return { ok: true };
}

export function normalizeAgentInput(input: AgentTaskInput): AgentTaskInput {
  const out: AgentTaskInput = { ...input };

  if (typeof out.prompt === "string") {
    out.prompt = out.prompt.trim();
  }

  if (typeof out.agentSlug === "string") {
    out.agentSlug = out.agentSlug.trim().toLowerCase();
  }

  return out;
}
