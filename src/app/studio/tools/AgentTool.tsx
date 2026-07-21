"use client";

import BaseStationShell from "@/app/agents/components/BaseStationShell";
import type { AgentId } from "@/app/agents/store/stationStore";

type AgentToolProps = {
  selectedAgentId?: AgentId | null;
  onSelectAgentAction?: (agentId: AgentId) => void;
  onOpenAgentChatAction?: (agentId: AgentId) => void;
  onAssignMissionAction?: (agentId: AgentId) => void;
  onOpenTerminalAction?: (agentId: AgentId) => void;
};

export default function AgentTool({
  selectedAgentId = null,
  onSelectAgentAction = () => {},
  onOpenAgentChatAction = () => {},
  onAssignMissionAction = () => {},
  onOpenTerminalAction = () => {},
}: AgentToolProps) {
  return (
    <BaseStationShell
      embedded
      selectedAgentId={selectedAgentId}
      onSelectAgentAction={onSelectAgentAction}
      onOpenAgentChatAction={onOpenAgentChatAction}
      onAssignMissionAction={onAssignMissionAction}
      onOpenTerminalAction={onOpenTerminalAction}
    />
  );
}
