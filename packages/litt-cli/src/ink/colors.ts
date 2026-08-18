/**
 * LiTT semantic color system.
 *
 * Purple is the LiTT brand color — it should make the cockpit
 * unmistakably LiTT. Every other color has a semantic meaning.
 *
 * | Meaning    | Color   |
 * | ---------- | ------- |
 * | LiTT/brand | magenta |  (Ink's "magenta" renders as purple on most terminals)
 * | Ready/pass | green   |
 * | Working    | cyan    |
 * | Warning    | yellow  |
 * | Failure    | red     |
 * | Secondary  | gray    |
 * | Main text  | white   |
 * | Info/link  | blue    |
 */

export const COLORS = {
  /** LiTT brand — purple/magenta. Used for LiTT identity, brain, brand elements */
  brand: "magenta",
  brandBright: "magentaBright",

  /** Success, ready, pass, complete */
  success: "green",
  successBright: "greenBright",

  /** Active work, in-progress, streaming */
  working: "cyan",
  workingBright: "cyanBright",

  /** Warnings, approval needed, rate-limited */
  warning: "yellow",
  warningBright: "yellowBright",

  /** Errors, failures, denied */
  error: "red",
  errorBright: "redBright",

  /** Secondary text, dim labels, inactive items */
  secondary: "gray",

  /** Primary text, main content */
  text: "white",

  /** Links, info, active model name */
  info: "blue",
} as const;

/** Agent lifecycle state → color */
export function stateColor(state: string): string {
  switch (state) {
    case "IDLE":
    case "READY":
      return COLORS.brand;
    case "UNDERSTANDING":
    case "THINKING":
    case "PLANNING":
      return COLORS.working;
    case "READING":
    case "EDITING":
    case "RUNNING":
    case "TESTING":
      return COLORS.working;
    case "VERIFYING":
      return COLORS.working;
    case "COMPLETE":
    case "SUCCESS":
      return COLORS.success;
    case "FAILED":
    case "ERROR":
      return COLORS.error;
    case "CANCELLED":
    case "TIMEOUT":
      return COLORS.warning;
    case "APPROVAL":
      return COLORS.warning;
    default:
      return COLORS.secondary;
  }
}

/** Activity tag → color */
export function activityColor(tag: string): string {
  switch (tag) {
    case "THINK":
    case "ROUTE":
    case "READ":
    case "EDIT":
    case "RUN":
      return COLORS.working;
    case "PASS":
    case "VERIFY":
    case "DONE":
      return COLORS.success;
    case "FAIL":
    case "ERROR":
      return COLORS.error;
    case "WARN":
    case "APPROVAL":
      return COLORS.warning;
    case "CHAT":
    case "INFO":
    case "LiTT":
      return COLORS.brand;
    default:
      return COLORS.secondary;
  }
}

/** Provider health → color */
export function healthColor(health: string): string {
  switch (health) {
    case "ready":
      return COLORS.success;
    case "unverified":
      return COLORS.warning;
    case "no-key":
      return COLORS.secondary;
    case "rate-limited":
      return COLORS.warning;
    case "down":
      return COLORS.error;
    default:
      return COLORS.secondary;
  }
}

/** Cost tier → display string */
export function costTier(cost: number): string {
  if (cost <= 1) return "$";
  if (cost <= 2) return "$$";
  if (cost <= 3) return "$$$";
  if (cost <= 4) return "$$$$";
  return "$$$$$";
}
