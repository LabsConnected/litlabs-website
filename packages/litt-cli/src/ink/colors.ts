/**
 * LiTT semantic color system — the premium shell palette.
 *
 * One controlled accent (warm LiTT orange/amber) and a strict contrast
 * hierarchy. If everything is orange, the design has failed.
 *
 * Priority:
 *   1. White  = content        (assistant body, user text, results)
 *   2. Gray   = metadata       (labels, timestamps, routing, events)
 *   3. Orange = LiTT/focus/action (mark, active selection, Plan/Act,
 *              composer accent, working glyph when appropriate)
 *   4. Green  = success
 *   5. Red    = failure
 *
 * Warm near-black backgrounds (terminal default) pair with warm text
 * grays — no pure bright-white-on-pure-black anywhere.
 *
 * | Meaning   | Value     | Role                                  |
 * | --------- | --------- | ------------------------------------- |
 * | brand     | #ff9e64   | LiTT accent — identity, focus, active |
 * | brandBright| #ffc777  | brighter accent (hover/emphasis)      |
 * | text      | #e4e1da   | assistant body — warm soft white      |
 * | textBright| #f7f5f0   | user text / important results         |
 * | secondary | #8d897f   | metadata — medium gray                |
 * | secondaryDim | #5f5c55 | dim gray — de-emphasized               |
 * | success   | #9ece6a   | muted green — pass/complete           |
 * | working   | #ffb454   | active work — warm amber              |
 * | warning   | #e0af68   | muted amber — warn/approval           |
 * | error     | #f7768e   | muted red — failure                   |
 * | info      | #7aa2f7   | muted blue — links/commands           |
 */

export const COLORS = {
  /** LiTT accent — warm amber/orange. Identity, focus, active action. */
  brand: "#ff9e64",
  brandBright: "#ffc777",

  /** Assistant body — warm near-white, never pure white. */
  text: "#e4e1da",

  /** User text / important results — brighter than metadata. */
  textBright: "#f7f5f0",

  /** Metadata — medium gray. */
  secondary: "#8d897f",

  /** Slightly brighter gray — branch names, emphasized metadata. */
  secondaryBright: "#a8a499",

  /** Dim gray — de-emphasized (routing footers, inactive states). */
  secondaryDim: "#5f5c55",

  /** Success, pass, complete — muted green. */
  success: "#9ece6a",

  /** Active work, in-progress, streaming — warm amber. */
  working: "#ffb454",

  /** Warnings, approval needed — muted amber. */
  warning: "#e0af68",

  /** Errors, failures, denied — muted red. */
  error: "#f7768e",

  /** Links, commands, info — muted blue. */
  info: "#7aa2f7",
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
    case "READING":
    case "EDITING":
    case "RUNNING":
    case "TESTING":
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
