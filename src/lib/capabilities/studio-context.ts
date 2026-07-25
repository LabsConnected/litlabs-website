import { translateCapabilities, type RawCapabilities } from "./translate";

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
  const raw: RawCapabilities = {
    repository: ctx.repositoryConnected ? "connected" : "none",
    repositoryIndexed: ctx.repositoryConnected,
    terminalExecution: ctx.terminalConnected ? "available" : "unavailable",
    terminalSessionId: ctx.terminalSessionId,
    connectedProviders: ctx.availableTools,
    availableTools: ctx.availableTools,
    connectionSummary: ctx.connectionSummary,
  };
  return translateCapabilities(raw).contextBlock;
}
