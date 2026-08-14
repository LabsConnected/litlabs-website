/**
 * MissionSection — shows the current mission/task.
 *
 * When idle: "Waiting for your next instruction."
 * When active: shows the current agent request text.
 */

import React from "react";
import { Box, Text } from "ink";
import type { HoloState } from "./cockpit-store.js";

export interface MissionSectionProps {
  holoState: HoloState;
  mission: string | null;
}

export function MissionSection({ holoState, mission }: MissionSectionProps): React.ReactElement {
  const active = holoState === "THINKING" || holoState === "RUNNING" || holoState === "VERIFYING";

  return (
    <Box flexDirection="column" marginTop={0}>
      <Text bold color="cyan">CURRENT MISSION</Text>
      <Text dimColor>────────────────────────────────────────────────────────────</Text>
      {active && mission ? (
        <Text color="cyan">{mission}</Text>
      ) : (
        <Text dimColor>Waiting for your next instruction.</Text>
      )}
    </Box>
  );
}
