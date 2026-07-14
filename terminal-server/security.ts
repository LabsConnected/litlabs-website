const BLOCKED_PATTERNS: RegExp[] = [
  /rm\s+-rf\s+\/(?!\w)/,
  /mkfs\b/,
  /:\(\)\s*\{\s*:\|\:\&\s*\}\s*;\s*:/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bhalt\b/,
  /dd\s+if=\/dev\/zero/,
  /chmod\s+-R\s+777\s+\//,
  /chown\s+-R\s+0:0\s+\//,
  />\s*\/dev\/sda\b/,
  /curl\b.*\|\s*(bash|sh)\b/,
  /wget\b.*\|\s*(bash|sh)\b/,
];

export function isBlockedCommand(input: string): boolean {
  const normalized = input.toLowerCase();
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function sanitizeEnv(value: string): string {
  return value.replace(/[^a-zA-Z0-9_\-\.:\/=@\s]/g, "");
}

export function redactSecrets(output: string): string {
  const patterns = [
    /(sk-[a-zA-Z0-9]{20,})/g,
    /(OPENROUTER_API_KEY=)[^\s&]*/g,
    /(CLERK_SECRET_KEY=)[^\s&]*/g,
    /(AUTH_SECRET=)[^\s&]*/g,
    /(SUPERMEMORY_API_KEY=)[^\s&]*/g,
    /(DATABASE_URL=)[^\s&]*/g,
  ];

  let result = output;
  for (const pattern of patterns) {
    result = result.replace(pattern, "$1***REDACTED***");
  }
  return result;
}
