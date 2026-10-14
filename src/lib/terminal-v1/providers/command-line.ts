/**
 * Split a command line into argv tokens, honoring single/double quotes and
 * backslash escapes.
 *
 * Used to execute commands WITHOUT a shell: `;`, `&&`, `|`, `$()`,
 * backticks, and globs become literal argv entries instead of being
 * interpreted (shell-string injection). Throws on unterminated quotes.
 */
export function tokenizeCommandLine(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let hasToken = false;

  for (const ch of input) {
    if (escaped) {
      current += ch;
      escaped = false;
      hasToken = true;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
        hasToken = true;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      hasToken = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (hasToken) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }
    current += ch;
    hasToken = true;
  }

  if (quote) {
    throw new Error("Unterminated quote in command");
  }
  if (escaped) {
    throw new Error("Trailing escape in command");
  }
  if (hasToken) {
    tokens.push(current);
  }
  return tokens;
}
