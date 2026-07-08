import { describe, it, expect } from "vitest";
import {
  validateAgentTaskInput,
  checkPromptSafety,
  normalizeAgentInput,
  REQUIRED_INPUT_KEYS,
} from "@/lib/agent-validation";

describe("validateAgentTaskInput", () => {
  const validInput = {
    prompt: "generate a landing page",
    context: "marketing site",
    agentSlug: "builder-01",
  };

  it("accepts a fully valid input", () => {
    expect(validateAgentTaskInput(validInput)).toEqual({ ok: true, errors: [] });
  });

  it("reports every missing required field", () => {
    const result = validateAgentTaskInput({});
    expect(result.ok).toBe(false);
    for (const key of REQUIRED_INPUT_KEYS) {
      expect(result.errors).toContain(`Missing required field: ${key}`);
    }
  });

  it("treats empty string, null, and undefined as missing", () => {
    const result = validateAgentTaskInput({
      prompt: "",
      context: null,
      agentSlug: undefined,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Missing required field: prompt");
    expect(result.errors).toContain("Missing required field: context");
    expect(result.errors).toContain("Missing required field: agentSlug");
  });

  it("rejects a prompt shorter than 4 characters", () => {
    const result = validateAgentTaskInput({ ...validInput, prompt: "hi" });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Prompt must be at least 4 characters");
  });

  it("rejects an agentSlug with invalid characters", () => {
    const result = validateAgentTaskInput({ ...validInput, agentSlug: "bad slug!" });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("agentSlug must match ^[a-z0-9-]+$");
  });

  it("returns a single error for a non-object input", () => {
    const result = validateAgentTaskInput(null as unknown as Record<string, unknown>);
    expect(result).toEqual({
      ok: false,
      errors: ["Input must be a non-null object"],
    });
  });
});

describe("checkPromptSafety", () => {
  it("allows a benign prompt", () => {
    expect(checkPromptSafety("build me a todo app")).toEqual({ ok: true });
  });

  it.each([
    "please rm -rf /",
    "go delete database now",
    "DROP TABLE users",
    "run sudo rm everything",
    "mkfs the disk",
    "format c: drive",
    "FORMAT C:",
  ])("blocks dangerous prompt: %s", (prompt) => {
    const result = checkPromptSafety(prompt);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("Prompt contains blocked instruction pattern");
  });

  it("does not block benign uses of the same words", () => {
    expect(checkPromptSafety("format the output as json").ok).toBe(true);
    expect(checkPromptSafety("format my resume").ok).toBe(true);
  });
});

describe("normalizeAgentInput", () => {
  it("trims the prompt and lowercases/trims the agentSlug", () => {
    const result = normalizeAgentInput({
      prompt: "  make a game  ",
      agentSlug: "  Builder-99  ",
      context: "keep me",
    });
    expect(result.prompt).toBe("make a game");
    expect(result.agentSlug).toBe("builder-99");
    expect(result.context).toBe("keep me");
  });

  it("does not mutate the original input", () => {
    const input = { prompt: "  x  ", agentSlug: "  Y  " };
    const result = normalizeAgentInput(input);
    expect(input.prompt).toBe("  x  ");
    expect(result).not.toBe(input);
  });

  it("leaves non-string fields untouched", () => {
    const result = normalizeAgentInput({ prompt: 5, agentSlug: 10 });
    expect(result.prompt).toBe(5);
    expect(result.agentSlug).toBe(10);
  });
});
