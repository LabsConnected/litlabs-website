/** Shared types for the unified LiTTree Terminal system. */

export type TerminalMode = "demo" | "real";

export type TerminalTab = {
  id: string;
  label: string;
  /** "bash" | "node" | "agent" | "demo" */
  type: string;
  active: boolean;
};

export type DemoCommand = {
  name: string;
  description: string;
  handler: (args: string[]) => DemoOutput;
};

export type DemoOutput = {
  lines: DemoLine[];
};

export type DemoLine = {
  text: string;
  color?: string;
  bold?: boolean;
};

export type AgentAction = {
  id: string;
  label: string;
  icon: string;
  description: string;
  command?: string;
  href?: string;
};

export type ConnectionStatus = "connecting" | "connected" | "offline" | "error";

export interface LiTTreeTerminalProps {
  /** "demo" = safe fake commands for public users. "real" = xterm.js + WebSocket. */
  mode: TerminalMode;
  /** Show the agent sidebar panel. */
  showAgentSidebar?: boolean;
  /** Project name shown in header. */
  projectName?: string;
  /** Commands to run on mount. */
  initialCommands?: string[];
  /** Custom CSS class for the outer container. */
  className?: string;
  /** Callback when a command is executed in demo mode. */
  onCommand?: (cmd: string) => void;
  /** Callback when connection status changes (real mode). */
  onConnectionChange?: (status: ConnectionStatus) => void;
}

export interface TerminalToolbarProps {
  tabs: TerminalTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  onAddTab: () => void;
  onCloseTab: (id: string) => void;
  connectionStatus: ConnectionStatus;
  mode: TerminalMode;
  onClear: () => void;
  onCopy: () => void;
  onToggleFullscreen: () => void;
  isFullscreen: boolean;
  onOpenCommandPalette: () => void;
}

export interface AgentSidebarProps {
  onRunAction: (action: AgentAction) => void;
  onSendMessage: (msg: string) => void;
  collapsed?: boolean;
  onToggle?: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onSelect: (command: string) => void;
  mode: TerminalMode;
}
