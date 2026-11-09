/**
 * Secret redaction for rendered activity text (feed rows + expanded detail).
 * Conservative: replace credential-shaped values, never truncate content.
 *
 * Covers the shapes that actually appear in tool arguments and command
 * output on this codebase's surfaces: provider keys, git tokens, Stripe,
 * Google, Slack, JWTs, Authorization headers, env-var assignments, and
 * common --flag secrets. When in doubt we redact — a false positive in
 * the feed is cheaper than a leaked credential.
 *
 * ORDER MATTERS: assignment/header patterns run before bare token shapes
 * so `token:ghp_x` is consumed as an assignment (the value is gone either
 * way) rather than leaving a partially-redacted marker behind.
 */
const PATTERNS: Array<[RegExp, string]> = [
  // Env-var / config assignments FIRST: API_KEY=x, MY_TOKEN: "x", token:ghp_x
  [/([A-Za-z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Za-z0-9_]*)\s*[=:]\s*["']?[^\s"']+/gi, "$1=•••"],
  // CLI flag secrets: --api-key=x, --token x (short flags like -p skipped — too ambiguous)
  [/(-{1,2})(api[-_]?key|apikey|token|access[-_]?token|auth[-_]?token|secret|password|passwd)(=|\s+)[^\s"']+/gi, "$1$2$3•••"],
  // Authorization-style headers — scheme-aware so "Bearer xxx" keeps its label
  [/(Authorization\s*[:=]\s*(?:Bearer\s+|Basic\s+)?)[^\s"']+/gi, "$1•••"],
  // Bearer tokens anywhere else
  [/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer •••"],
  // Provider / platform tokens (shape-anchored)
  [/\bgithub_pat_[A-Za-z0-9_]{10,}/g, "github_pat_•••"],
  [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{10,}/g, "$1_•••"],
  [/\bxox[baprs]-[A-Za-z0-9-]{8,}/g, "xox•-•••"],
  [/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}/g, "$1_$2_•••"],
  [/\bwhsec_[A-Za-z0-9]{8,}/g, "whsec_•••"],
  [/\bsbp_[A-Za-z0-9]{8,}/g, "sbp_•••"],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, "AIza•••"],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-•••"],
  // JWTs (three base64url segments, first starts eyJ)
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, "eyJ•••"],
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}
