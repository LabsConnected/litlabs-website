"use client";

import BaseStationShell from "@/app/agents/components/BaseStationShell";
import type { AgentId } from "@/app/agents/store/stationStore";

type AgentToolProps = {
  selectedAgentId?: AgentId | null;
  onSelectAgentAction?: (agentId: AgentId) => void;
  onOpenAgentChatAction?: (agentId: AgentId) => void;
  onAssignMissionAction?: (agentId: AgentId) => void;
  onOpenTerminalAction?: (agentId: AgentId) => void;
  busyAgentId?: AgentId | null;
};

export default function AgentTool({
  selectedAgentId = null,
  onSelectAgentAction = () => {},
  onOpenAgentChatAction = () => {},
  onAssignMissionAction = () => {},
  onOpenTerminalAction = () => {},
  busyAgentId = null,
}: AgentToolProps) {
  return (
    <BaseStationShell
      embedded
      selectedAgentId={selectedAgentId}
      onSelectAgentAction={onSelectAgentAction}
      onOpenAgentChatAction={onOpenAgentChatAction}
      onAssignMissionAction={onAssignMissionAction}
      onOpenTerminalAction={onOpenTerminalAction}
      busyAgentId={busyAgentId}
    />
  );
}
