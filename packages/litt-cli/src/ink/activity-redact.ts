/**
 * Secret redaction for rendered activity text (feed rows + expanded detail).
 * Conservative: replace credential-shaped values, never truncate content.
 */
const PATTERNS: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9_-]{8,}/g, "sk-•••"],
  [/Bearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer •••"],
  [/([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*[=:]\s*["']?[^\s"']+/g, "$1=•••"],
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}
