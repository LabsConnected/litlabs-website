/**
 * LiTT semantic color system — the premium shell palette.
 *
 * Purple is the product identity. Gold is reserved for the moments that
 * need the operator's attention (approvals, high-value decisions). If
 * everything is purple and gold, the design has failed.
 *
 * Priority:
 *   1. White  = content        (assistant body, user text, results)
 *   2. Gray   = metadata       (labels, timestamps, routing, events)
 *   3. Purple = LiTT/focus/active (mark, active selection, Plan/Act,
 *              composer accent, active work glyph)
 *   4. Gold   = approval / attention / high-value emphasis ONLY
 *   5. Green  = success
 *   6. Red    = failure
 *
 * Near-black background (#09090B — the terminal's own) pairs with clean
 * neutral text — no warm tint, no pure bright-white-on-pure-black.
 *
 * | Meaning   | Value     | Role                                   |
 * | --------- | --------- | -------------------------------------- |
 * | brand     | #A855F7   | LiTT purple — identity, focus, active  |
 * | brandBright| #C084FC  | brighter purple (hover/emphasis)       |
 * | deep      | #7C3AED   | deep purple — borders, depth           |
 * | gold      | #F5C451   | approval / attention / high-value      |
 * | goldBright| #FFD76A   | bright gold (pinned approval accents)  |
 * | text      | #F4F4F5   | assistant body — clean soft white      |
 * | textBright| #FAFAFA   | user text / important results          |
 * | secondary | #8B8FA3   | metadata — muted slate gray            |
 * | secondaryBright | #A6AAB8 | emphasized metadata (branch names) |
 * | secondaryDim | #5C5F6E | dim gray — de-emphasized             |
 * | success   | #4ADE80   | green — pass/complete                  |
 * | working   | #A855F7   | active work — LiTT purple (identity)   |
 * | warning   | #FBBF24   | amber — warn (non-blocking attention)  |
 * | error     | #F87171   | red — failure                          |
 * | info      | #C084FC   | links/commands — bright purple         |
 */

export const COLORS = {
  /** LiTT purple — identity, focus, active action. */
  brand: "#A855F7",
  brandBright: "#C084FC",

  /** Deep purple — borders, depth, secondary identity surfaces. */
  deep: "#7C3AED",

  /** Gold — approvals, high-value emphasis. Never decorative. */
  gold: "#F5C451",
  goldBright: "#FFD76A",

  /** Assistant body — clean near-white. */
  text: "#F4F4F5",

  /** User text / important results — brighter than metadata. */
  textBright: "#FAFAFA",

  /** Metadata — muted slate gray. */
  secondary: "#8B8FA3",

  /** Slightly brighter gray — branch names, emphasized metadata. */
  secondaryBright: "#A6AAB8",

  /** Dim gray — de-emphasized (routing footers, inactive states). */
  secondaryDim: "#5C5F6E",

  /** Success, pass, complete — green. */
  success: "#4ADE80",

  /** Active work, in-progress, streaming — LiTT purple (identity). */
  working: "#A855F7",

  /** Warnings — amber. Approval surfaces use gold instead. */
  warning: "#FBBF24",

  /** Errors, failures, denied — red. */
  error: "#F87171",

  /** Links, commands, info — bright purple. */
  info: "#C084FC",

  /** Remote / cloud — blue. Distinct from local green. */
  remote: "#60A5FA",
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
      return COLORS.gold;
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
      return COLORS.warning;
    case "APPROVAL":
      return COLORS.gold;
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
