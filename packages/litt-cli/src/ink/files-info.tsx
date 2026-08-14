/**
 * FilesInfo — shows git working tree status.
 *
 * Displays modified/untracked file counts from the project's
 * git status, derived from actual git output.
 */

import React from "react";
import { Box, Text } from "ink";

export interface FilesInfoProps {
  modified: number;
  untracked: number;
}

export function FilesInfo({ modified, untracked }: FilesInfoProps): React.ReactElement {
  const parts: string[] = [];
  if (modified > 0) parts.push(`${modified} modified`);
  if (untracked > 0) parts.push(`${untracked} untracked`);
  if (parts.length === 0) parts.push("clean");

  const color = modified > 0 ? "yellow" : "green";

  return (
    <Box flexDirection="column">
      <Text dimColor bold>FILES</Text>
      <Text color={color}>{parts.join(" • ")}</Text>
    </Box>
  );
}
