import { describe, expect, it } from "vitest";
import { tokenizeShellArgs } from "../lib/shell-args.js";

describe("tokenizeShellArgs", () => {
  // ─── Basic splitting ──────────────────────────────────────────

  it("splits simple whitespace-separated tokens", () => {
    expect(tokenizeShellArgs("echo hello").tokens).toEqual(["echo", "hello"]);
  });

  it("handles multiple spaces between tokens", () => {
    expect(tokenizeShellArgs("echo    hello").tokens).toEqual(["echo", "hello"]);
  });

  it("handles leading and trailing whitespace", () => {
    expect(tokenizeShellArgs("  echo hello  ").tokens).toEqual(["echo", "hello"]);
  });

  it("handles tabs as separators", () => {
    expect(tokenizeShellArgs("echo\thello").tokens).toEqual(["echo", "hello"]);
  });

  it("handles newlines as separators", () => {
    expect(tokenizeShellArgs("echo\nhello").tokens).toEqual(["echo", "hello"]);
  });

  // ─── Single-arg /verify (the original use case) ───────────────

  it("passes a single token through as one-element argv", () => {
    expect(tokenizeShellArgs("/verify").tokens).toEqual(["/verify"]);
  });

  it("passes a single-arg do command without splitting", () => {
    // `litt do --remote /verify` → rest=["/verify"] → one token
    expect(tokenizeShellArgs("/verify").tokens).toHaveLength(1);
  });

  // ─── Empty input ──────────────────────────────────────────────

  it("returns empty array for empty string", () => {
    expect(tokenizeShellArgs("").tokens).toEqual([]);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(tokenizeShellArgs("   ").tokens).toEqual([]);
  });

  // ─── Quoted arguments containing spaces ───────────────────────

  it("preserves spaces inside single quotes", () => {
    expect(tokenizeShellArgs("echo 'hello world'").tokens).toEqual(["echo", "hello world"]);
  });

  it("preserves spaces inside double quotes", () => {
    expect(tokenizeShellArgs('echo "hello world"').tokens).toEqual(["echo", "hello world"]);
  });

  it("handles nested quotes (single inside double)", () => {
    expect(tokenizeShellArgs('echo "say \'hi\'"').tokens).toEqual(["echo", "say 'hi'"]);
  });

  it("handles nested quotes (double inside single)", () => {
    expect(tokenizeShellArgs("echo 'say \"hi\"'").tokens).toEqual(["echo", 'say "hi"']);
  });

  it("handles multiple quoted args", () => {
    expect(tokenizeShellArgs('echo "hello world" "foo bar"').tokens).toEqual([
      "echo",
      "hello world",
      "foo bar",
    ]);
  });

  // ─── Escaped quotes ───────────────────────────────────────────

  it("escapes double quote inside double quotes with backslash", () => {
    expect(tokenizeShellArgs('echo "say \\"hi\\""').tokens).toEqual(["echo", 'say "hi"']);
  });

  it("preserves backslash-literal outside quotes when not an escape sequence", () => {
    // \w outside quotes — backslash escapes next char, so \w → w
    expect(tokenizeShellArgs("echo \\w").tokens).toEqual(["echo", "w"]);
  });

  it("escapes backslash itself inside double quotes", () => {
    expect(tokenizeShellArgs('echo "a\\\\b"').tokens).toEqual(["echo", "a\\b"]);
  });

  it("handles escaped dollar sign inside double quotes", () => {
    expect(tokenizeShellArgs('echo "\\$HOME"').tokens).toEqual(["echo", "$HOME"]);
  });

  it("handles escaped backtick inside double quotes", () => {
    expect(tokenizeShellArgs('echo "\\`pwd`"').tokens).toEqual(["echo", "`pwd`"]);
  });

  it("backslash outside quotes escapes the next character", () => {
    // \  → literal space (escaped)
    expect(tokenizeShellArgs("echo hello\\ world").tokens).toEqual(["echo", "hello world"]);
  });

  // ─── Multiple arguments ───────────────────────────────────────

  it("handles command with many args", () => {
    // Single quotes are delimiters — they get stripped, content kept.
    // So console.log('ok') → console.log(ok) as a single token.
    expect(tokenizeShellArgs("node -e console.log('ok')").tokens).toEqual([
      "node",
      "-e",
      "console.log(ok)",
    ]);
  });

  it("handles mixed quoted and unquoted args", () => {
    expect(tokenizeShellArgs('git commit -m "hello world" --amend').tokens).toEqual([
      "git",
      "commit",
      "-m",
      "hello world",
      "--amend",
    ]);
  });

  it("handles args with special characters", () => {
    expect(tokenizeShellArgs("echo $HOME /tmp/file.txt").tokens).toEqual([
      "echo",
      "$HOME",
      "/tmp/file.txt",
    ]);
  });

  // ─── Error cases ──────────────────────────────────────────────

  it("returns error for unmatched single quote", () => {
    const result = tokenizeShellArgs("echo 'hello");
    expect(result.tokens).toEqual([]);
    expect(result.error).toBe("Unmatched single quote");
  });

  it("returns error for unmatched double quote", () => {
    const result = tokenizeShellArgs('echo "hello');
    expect(result.tokens).toEqual([]);
    expect(result.error).toBe("Unmatched double quote");
  });

  it("returns error for unmatched single quote in middle", () => {
    const result = tokenizeShellArgs("echo 'hello' world 'foo");
    expect(result.tokens).toEqual([]);
    expect(result.error).toBe("Unmatched single quote");
  });
});
