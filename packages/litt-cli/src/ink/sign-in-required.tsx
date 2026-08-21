/**
 * SignInRequired — the sign-in-required screen shown when `litt` is
 * launched without valid credentials.
 *
 * Renders a clean LiTT-branded message prompting the user to run
 * `litt login`. Stays in the terminal (Ink) until the user presses
 * a key to exit.
 *
 * This is NOT the cockpit — the cockpit is only mounted after
 * successful authentication.
 */

import React, { useEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { COLORS } from "./colors.js";

export interface SignInRequiredProps {
  /** Error message if auth failed (e.g. expired refresh token). */
  error?: string | null;
  /** Whether auth config is available (always true with safe production defaults). */
  configAvailable: boolean;
}

export function SignInRequired({ error, configAvailable }: SignInRequiredProps): React.ReactElement {
  const { exit } = useApp();

  useInput((input) => {
    // Any key exits — the user runs `litt login` separately
    if (input === "q" || input === "l" || input === "\r" || input === "\x03") {
      exit();
    }
  });

  // Auto-exit after 10s if no key pressed (non-blocking)
  useEffect(() => {
    const timer = setTimeout(() => exit(), 10_000);
    return () => clearTimeout(timer);
  }, [exit]);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color={COLORS.brand}>⚡ LiTT</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={COLORS.error}>Not signed in.</Text>
      </Box>

      {error && (
        <Box marginBottom={1}>
          <Text dimColor>{error}</Text>
        </Box>
      )}

      {!configAvailable ? (
        <Box marginBottom={1}>
          <Text>
            Auth is not configured. Run <Text bold color={COLORS.brand}>litt login</Text> to sign in.
          </Text>
        </Box>
      ) : (
        <Box marginBottom={1}>
          <Text>
            Run <Text bold color={COLORS.brand}>litt login</Text> to sign in.
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>Press any key to exit (or run 'litt login' in your terminal).</Text>
      </Box>
    </Box>
  );
}
