export interface ConnectionAuditEntry {
  provider: string;
  action: "connect" | "disconnect" | "error";
  timestamp: string;
  details?: string;
}

export async function logAudit(
  _userId: string,
  _provider: string,
  _action: string,
  _error?: string,
  _metadata?: Record<string, unknown>,
): Promise<void> {
}

export async function auditConnection(
  _userId: string,
  _entry: Omit<ConnectionAuditEntry, "timestamp">,
): Promise<void> {
}

export async function getAuditLog(
  _userId: string,
  _limit = 50,
): Promise<ConnectionAuditEntry[]> {
  return [];
}
