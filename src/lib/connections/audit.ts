export interface ConnectionAuditEntry {
  provider: string;
  action: "connect" | "disconnect" | "error";
  timestamp: string;
  details?: string;
}

export async function logAudit(
  userId: string,
  provider: string,
  action: string,
  _error?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  console.debug(`[audit] ${userId} ${provider} ${action}`, metadata);
}

export async function auditConnection(
  userId: string,
  entry: Omit<ConnectionAuditEntry, "timestamp">,
): Promise<void> {
  console.debug(`[audit] ${userId} ${entry.provider} ${entry.action}`, entry.details);
}

export async function getAuditLog(
  _userId: string,
  _limit = 50,
): Promise<ConnectionAuditEntry[]> {
  return [];
}
