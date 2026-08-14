/**
 * Spinner — lightweight animated spinner for Ink.
 *
 * Uses setInterval to cycle through frames. Cleans up on unmount.
 * Frame set depends on the spinner type.
 */

import React, { useState, useEffect } from "react";
import { Text } from "ink";

const FRAMES: Record<string, string[]> = {
  dots: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  pulse: ["◇", "◆", "◇", "·"],
  arrow: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"],
  bounce: ["⠁", "⠂", "⠄", "⠂"],
};

export interface SpinnerProps {
  type?: keyof typeof FRAMES;
  color?: string;
  interval?: number;
}

export function Spinner({ type = "dots", color = "cyan", interval = 80 }: SpinnerProps): React.ReactElement {
  const frames = FRAMES[type] ?? FRAMES.dots;
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(prev => (prev + 1) % frames.length);
    }, interval);
    return () => clearInterval(timer);
  }, [frames.length, interval]);

  return <Text color={color}>{frames[frame]}</Text>;
}
