/**
 * CockpitErrorBoundary — catches UI-level failures (spec §39).
 *
 * If the cockpit itself crashes, render a concise error message and
 * restore terminal state. Do NOT leave raw mode enabled after a crash.
 *
 *   LiTT cockpit encountered an error.
 *   <concise message>
 *   Run: litt doctor
 */

import React, { useEffect } from "react";
import { Box, Text, useApp } from "ink";

export interface CockpitErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorState {
  error: Error | null;
}

export class CockpitErrorBoundary extends React.Component<CockpitErrorBoundaryProps, ErrorState> {
  state: ErrorState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Log to stderr — never swallow the stack silently.
    console.error("[LiTT cockpit] UI crash:", error, info.componentStack);
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      return <CrashView message={this.state.error.message} />;
    }
    return this.props.children;
  }
}

function CrashView({ message }: { message: string }): React.ReactElement {
  const { exit } = useApp();

  // Restore terminal state — disable raw mode if it was enabled.
  // Ink normally handles this on unmount, but a crash mid-render may
  // leave the terminal in a bad state. Best-effort restoration.
  try {
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(false);
    }
  } catch {
    // ignore — best-effort restoration
  }

  // Exit after a short delay so the user can read the message.
  useEffect(() => {
    const id = setTimeout(() => exit(), 100);
    return () => clearTimeout(id);
  }, [exit]);

  const shortMsg = message.length > 100 ? message.slice(0, 99) + "…" : message;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="red">{"LiTT cockpit encountered an error."}</Text>
      <Text color="red">{shortMsg}</Text>
      <Text dimColor>{""}</Text>
      <Text dimColor>{"Run:"}</Text>
      <Text color="cyan">{"  litt doctor"}</Text>
    </Box>
  );
}
