export interface StudioContext {
  terminalConnected: boolean;
  terminalSessionId: string | null;
  repositoryConnected: boolean;
  availableTools: string[];
  connectionSummary: string;
}

export async function getStudioContext(): Promise<StudioContext> {
  return {
    terminalConnected: false,
    terminalSessionId: null,
    repositoryConnected: false,
    availableTools: [],
    connectionSummary: "No services connected.",
  };
}

export function buildCapabilityContextForChat(ctx: StudioContext): string {
  const parts: string[] = [];
  parts.push(`Terminal: ${ctx.terminalConnected ? "connected" : "disconnected"}`);
  if (ctx.terminalSessionId) parts.push(`Session: ${ctx.terminalSessionId.slice(0, 8)}`);
  parts.push(`Repository: ${ctx.repositoryConnected ? "connected" : "not connected"}`);
  parts.push(`Tools: ${ctx.availableTools.length > 0 ? ctx.availableTools.join(", ") : "none"}`);
  parts.push(`Summary: ${ctx.connectionSummary}`);
  return parts.join("\n");
}
