/**
 * FilesInfo — git working tree status + mission files.
 *
 * Shows:
 *   - Modified/untracked file counts from git
 *   - Files touched during the current mission (with M/+/ markers)
 *   - Total changed count
 *
 * During work:
 *   FILES
 *   M src/app.tsx
 *   M src/model-picker.tsx
 *   + src/lib/model-routing.ts
 *
 *   3 changed
 */

import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "./colors.js";

export interface FilesInfoProps {
  modified: number;
  untracked: number;
  /** Files touched during the current mission */
  missionFiles?: string[];
}

export function FilesInfo({ modified, untracked, missionFiles = [] }: FilesInfoProps): React.ReactElement {
  const hasMissionFiles = missionFiles.length > 0;
  const totalChanged = modified + untracked;

  return (
    <Box flexDirection="column">
      <Text dimColor bold>FILES</Text>
      {hasMissionFiles ? (
        // Show mission files with markers
        <Box flexDirection="column">
          {missionFiles.map((file) => {
            const shortFile = file.length > 50 ? "..." + file.slice(-47) : file;
            return (
              <Box key={file}>
                <Text color={COLORS.warning} bold>M </Text>
                <Text color={COLORS.text}>{shortFile}</Text>
              </Box>
            );
          })}
          <Box marginTop={0}>
            <Text dimColor>{missionFiles.length} changed</Text>
          </Box>
        </Box>
      ) : totalChanged > 0 ? (
        <Box flexDirection="column">
          {modified > 0 && (
            <Box>
              <Text color={COLORS.warning}>M </Text>
              <Text dimColor>{modified} modified</Text>
            </Box>
          )}
          {untracked > 0 && (
            <Box>
              <Text color={COLORS.success}>+ </Text>
              <Text dimColor>{untracked} untracked</Text>
            </Box>
          )}
          <Box marginTop={0}>
            <Text dimColor>{totalChanged} changed</Text>
          </Box>
        </Box>
      ) : (
        <Text color={COLORS.success}>clean</Text>
      )}
    </Box>
  );
}
