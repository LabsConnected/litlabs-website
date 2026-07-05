/** Ghostty-inspired terminal theme for LiTTree Terminal. */

export const TERMINAL_THEME = {
  /** xterm.js theme object */
  xterm: {
    background: "#0a0a0f",
    foreground: "#e4e4e8",
    cursor: "#a855f7",
    cursorAccent: "#0a0a0f",
    selectionBackground: "#a855f740",
    selectionForeground: "#ffffff",
    selectionInactiveBackground: "#a855f720",
    black: "#1a1a2e",
    red: "#ff6b6b",
    green: "#69f0ae",
    yellow: "#ffd93d",
    blue: "#6dd5fa",
    magenta: "#c084fc",
    cyan: "#22d3ee",
    white: "#e4e4e8",
    brightBlack: "#3a3a5c",
    brightRed: "#ff8a8a",
    brightGreen: "#8fffca",
    brightYellow: "#ffe566",
    brightBlue: "#93e0ff",
    brightMagenta: "#d8b4fe",
    brightCyan: "#67e8f9",
    brightWhite: "#ffffff",
  },

  /** Terminal font settings */
  font: {
    family: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
    size: 14,
    lineHeight: 1.4,
  },

  /** UI colors for panels, borders, toolbars */
  ui: {
    bg: "#0a0a0f",
    bgSecondary: "#0f0f17",
    bgTertiary: "#141420",
    border: "#1e1e2e",
    borderAccent: "#a855f730",
    accent: "#a855f7",
    accentSecondary: "#22d3ee",
    accentGlow: "#a855f720",
    success: "#69f0ae",
    error: "#ff6b6b",
    warning: "#ffd93d",
    text: "#e4e4e8",
    textMuted: "#6b7280",
    textDim: "#3a3a5c",
  },

  /** Tab/toolbar specific */
  toolbar: {
    height: 40,
    tabActiveBg: "#a855f718",
    tabActiveText: "#a855f7",
    tabInactiveText: "#6b7280",
    tabHoverBg: "#ffffff08",
  },

  /** Status indicator colors */
  status: {
    online: "#69f0ae",
    offline: "#ff6b6b",
    connecting: "#ffd93d",
    error: "#ff6b6b",
  },
} as const;

/** ANSI escape helpers for demo mode output */
export const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  bgPurple: "\x1b[45m",
} as const;
