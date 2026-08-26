/**
 * Shell argument tokenizer — splits a single string into argv tokens,
 * respecting single quotes, double quotes, and backslash escaping.
 *
 * This is used by the `do --remote` dispatch path when the user passes
 * a single quoted string (e.g. `litt do --remote "echo hello"`) and
 * the server expects a structured argv array (e.g. `["echo", "hello"]`).
 *
 * Rules (POSIX-ish, simplified):
 *   - Unquoted whitespace separates tokens.
 *   - Single quotes preserve everything literally until the next `'`.
 *   - Double quotes preserve everything literally except `\` escapes
 *     the next char (`\"`, `\\`, `\$`, `` \` ``).
 *   - Backslash outside quotes escapes the next char.
 *   - Trailing unmatched quote is a parse error.
 *
 * This is NOT a full POSIX shell parser — no variable expansion, no
 * command substitution, no globbing. It only tokenizes.
 */

export interface TokenizeResult {
  tokens: string[];
  error?: string;
}

/**
 * Tokenize a shell argument string into an argv array.
 * Returns `{ tokens }` on success or `{ tokens: [], error }` on parse error.
 */
export function tokenizeShellArgs(input: string): TokenizeResult {
  const tokens: string[] = [];
  let current = "";
  let i = 0;
  let inToken = false;
  let inSingle = false;
  let inDouble = false;

  while (i < input.length) {
    const ch = input[i];

    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else {
        current += ch;
      }
      i++;
      continue;
    }

    if (inDouble) {
      if (ch === "\\") {
        // Inside double quotes, backslash escapes: " \ $ ` and newline
        const next = input[i + 1];
        if (next === '"' || next === "\\" || next === "$" || next === "`" || next === "\n") {
          current += next;
          i += 2;
        } else {
          current += ch;
          i++;
        }
      } else if (ch === '"') {
        inDouble = false;
        i++;
      } else {
        current += ch;
        i++;
      }
      continue;
    }

    // Outside quotes
    if (ch === "\\") {
      const next = input[i + 1];
      if (next !== undefined) {
        current += next;
        inToken = true;
        i += 2;
      } else {
        // Trailing backslash — literal
        current += ch;
        inToken = true;
        i++;
      }
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      inToken = true;
      i++;
      continue;
    }

    if (ch === '"') {
      inDouble = true;
      inToken = true;
      i++;
      continue;
    }

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      if (inToken) {
        tokens.push(current);
        current = "";
        inToken = false;
      }
      i++;
      continue;
    }

    current += ch;
    inToken = true;
    i++;
  }

  if (inSingle) {
    return { tokens: [], error: "Unmatched single quote" };
  }
  if (inDouble) {
    return { tokens: [], error: "Unmatched double quote" };
  }
  if (inToken) {
    tokens.push(current);
  }

  return { tokens };
}
