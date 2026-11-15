/**
 * Tests for parseJarvisActions transcript hygiene.
 *
 * Production incident 2026-11-15: a Studio chat reply quoted an image
 * prompt inside an UNTAGGED fenced block, and parseJarvisActions treated
 * that prose as a runnable shell command — the reply sprouted a
 * "Run in terminal / Terminal not connected" chip. Only fenced blocks
 * with an explicit shell language tag (bash|sh|shell|zsh) are commands.
 *
 * Run: npx vitest run src/lib/litt-context.test.ts
 */
import { describe, it, expect } from "vitest";
import { parseJarvisActions } from "@/lib/litt-context";

describe("parseJarvisActions", () => {
  it("untagged prose block yields no action (the lion prompt case)", () => {
    const answer = [
      "I can't generate image files directly, but here is a ready-to-use prompt:",
      "",
      "```",
      "A majestic male lion in its natural habitat, perhaps on the savanna",
      "```",
    ].join("\n");
    expect(parseJarvisActions(answer)).toEqual([]);
  });

  it("untagged block yields no action even when its content looks like a command", () => {
    const answer = "Try this:\n\n```\nnpm run build\n```";
    expect(parseJarvisActions(answer)).toEqual([]);
  });

  it("non-shell language blocks yield no action", () => {
    const answer = "Example:\n\n```js\nconsole.log('hello');\n```";
    expect(parseJarvisActions(answer)).toEqual([]);
  });

  it("plain prose with no code block yields no action", () => {
    expect(parseJarvisActions("Just a normal reply with no code.")).toEqual([]);
  });

  it("```bash block still yields insert + run actions", () => {
    const answer = "Run this:\n\n```bash\nnpm run build\n```";
    const actions = parseJarvisActions(answer);
    expect(actions).toHaveLength(2);
    expect(actions.map((a) => a.type)).toEqual(["insert_command", "run_command"]);
    expect(actions[0].command).toBe("npm run build");
    expect(actions[1].command).toBe("npm run build");
  });

  it("```sh and ```shell blocks still yield actions", () => {
    for (const tag of ["sh", "shell"]) {
      const actions = parseJarvisActions("```" + tag + "\nls -la\n```");
      expect(actions).toHaveLength(2);
      expect(actions[1].type).toBe("run_command");
      expect(actions[1].command).toBe("ls -la");
    }
  });

  it("```zsh block yields actions", () => {
    const actions = parseJarvisActions("```zsh\ngit status\n```");
    expect(actions).toHaveLength(2);
    expect(actions[1].command).toBe("git status");
  });

  it("an untagged block before a bash block does not shadow the bash command", () => {
    const answer = [
      "Prompt:",
      "",
      "```",
      "A majestic male lion in its natural habitat",
      "```",
      "",
      "Then run:",
      "",
      "```bash",
      "npm test",
      "```",
    ].join("\n");
    const actions = parseJarvisActions(answer);
    expect(actions).toHaveLength(2);
    expect(actions[1].command).toBe("npm test");
  });
});
