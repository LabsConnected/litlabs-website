/**
 * KeyboardHelp — bottom keyboard shortcut reference line.
 */

import React from "react";
import { Text } from "ink";

export function KeyboardHelp(): React.ReactElement {
  return (
    <Text dimColor>F2 model · Ctrl+K actions · Ctrl+C cancel · Ctrl+L clear · Esc close</Text>
  );
}
