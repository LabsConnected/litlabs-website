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
  /\bcurl\b/,
  /\bwget\b/,
  /\bnc\b/,
  /\bnetcat\b/,
  /\bssh\b.*-R\b/,
  /\bbase64\b.*\|\s*(bash|sh)\b/,
  /\$\([^)]*\)/,
  /`[^`]*`/,
  /\bkill\s+-9\s+1\b/,
  /\bkillall\b/,
  /\bpkill\b.*-1\b/,
];

export function isBlockedCommand(input: string): boolean {
  const normalized = input.toLowerCase();
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(normalized));
}

export interface AuditEntry {
  timestamp: string;
  userId: string;
  sessionId: string;
  command: string;
  blocked: boolean;
}

const auditLog: AuditEntry[] = [];
const MAX_AUDIT_ENTRIES = 10_000;

export function auditCommand(userId: string, sessionId: string, command: string, blocked: boolean): void {
  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    userId,
    sessionId,
    command: command.slice(0, 500),
    blocked,
  };
  auditLog.push(entry);
  if (auditLog.length > MAX_AUDIT_ENTRIES) {
    auditLog.splice(0, auditLog.length - MAX_AUDIT_ENTRIES);
  }
  if (blocked) {
    console.warn(`[Audit] Blocked command by ${userId} in ${sessionId}: ${entry.command}`);
  }
}

export function getAuditLog(limit = 100): AuditEntry[] {
  return auditLog.slice(-limit);
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
