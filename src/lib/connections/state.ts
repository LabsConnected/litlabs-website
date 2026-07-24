export interface ConnectionState {
  provider: string;
  connected: boolean;
  connectedAt: string | null;
  metadata?: Record<string, unknown>;
}

const states: Map<string, ConnectionState> = new Map();

export function getConnectionState(provider: string): ConnectionState | null {
  return states.get(provider) ?? null;
}

export function setConnectionState(provider: string, connected: boolean, metadata?: Record<string, unknown>): void {
  states.set(provider, {
    provider,
    connected,
    connectedAt: connected ? new Date().toISOString() : null,
    metadata,
  });
}

export function getAllConnections(): ConnectionState[] {
  return Array.from(states.values());
}

export async function upsertConnection(
  userId: string,
  provider: string,
  data: {
    connectionMethod?: string;
    status?: string;
    externalAccountId?: string;
    externalAccountName?: string;
    grantedScopes?: string[];
    [key: string]: unknown;
  },
): Promise<void> {
  setConnectionState(provider, data.status === "connected", data);
  console.debug(`[connection] upsert ${userId} ${provider}`, data);
}
