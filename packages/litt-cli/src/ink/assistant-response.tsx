import React from "react";
import { Box, Text } from "ink";

export interface AssistantResponsePanelProps {
  text: string;
  streaming: boolean;
  maxChars?: number;
}

export function AssistantResponsePanel({
  text,
  streaming,
  maxChars = 1000,
}: AssistantResponsePanelProps): React.ReactElement | null {
  if (!streaming && !text.trim()) return null;

  const clean = text.trimStart();
  const truncated = clean.length > maxChars;

  const visible = truncated
    ? `…${clean.slice(-(maxChars - 1))}`
    : clean;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={streaming ? "cyan" : "magenta"}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text bold color="magenta">
          LiTT
        </Text>

        <Text color={streaming ? "cyan" : "green"}>
          {streaming ? "● RESPONDING" : "✓ RESPONSE"}
        </Text>
      </Box>

      <Text wrap="wrap">
        {visible || "…"}
      </Text>

      {truncated && (
        <Text dimColor>
          Showing latest {maxChars} characters
        </Text>
      )}
    </Box>
  );
}