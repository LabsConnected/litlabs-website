/**
 * Transport projection — the SINGLE source of truth for how the active
 * execution transport is displayed.
 *
 * The bug this module exists to prevent:
 *   The header derived its own label from `remoteRuntime` while the
 *   status bar hardcoded "LOCAL" and never even received `remoteRuntime`
 *   as a prop. The two surfaces could therefore assert different things
 *   at the same moment — header "● REMOTE", footer "● LOCAL" — and the
 *   operator had no way to know which one described reality.
 *
 * The fix is structural, not cosmetic: both surfaces now render from
 * ONE derivation. They cannot disagree because they no longer compute
 * anything independently.
 *
 * The two labels answer DIFFERENT questions, which is why the old
 * shared "LOCAL" wording was ambiguous:
 *
 *   header  → WHERE DOES THIS COMMAND EXECUTE?   (LOCAL / REMOTE)
 *   footer  → ARE LOCAL TOOLS AVAILABLE?          (TOOLS)
 *
 * The footer says TOOLS precisely because local tool availability is
 * independent of execution path — local tooling stays ready even while
 * execution is remote. Labelling that "LOCAL" made it read as an
 * execution-path claim contradicting the header.
 */

export type LocalRuntimeState = "starting" | "ready" | "error" | string;
export type RemoteRuntimeState =
  | "offline"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error"
  | string;

/** Where commands actually execute right now. */
export type ExecutionPath = "local" | "remote" | "none";

export interface TransportInput {
  localRuntime: LocalRuntimeState;
  remoteRuntime: RemoteRuntimeState;
  /** False renders the signed-out projection regardless of runtimes. */
  signedIn?: boolean;
}

export interface TransportProjection {
  /** The path commands ACTUALLY execute on. */
  executionPath: ExecutionPath;
  /** Header text — describes the execution path. */
  headerLabel: string;
  /** Footer text — describes local TOOL availability, never the path. */
  footerLabel: string;
  /** True only when the remote transport is fully established. */
  remoteActive: boolean;
  /** True when the remote indicator should be shown at all. */
  showRemote: boolean;
  /** Semantic severity for colouring, so surfaces don't re-derive it. */
  headerSeverity: "ok" | "pending" | "error";
  footerSeverity: "ok" | "pending" | "error";
}

/**
 * Derive the complete transport projection.
 *
 * Invariants (enforced by tests):
 *   1. headerLabel says REMOTE only when remoteRuntime === "connected".
 *      Connecting/reconnecting/error render distinct, non-committal
 *      labels — they never claim REMOTE outright.
 *   2. executionPath === "remote" only when remoteActive is true.
 *   3. footerLabel never contains "LOCAL" — it is always TOOLS-based,
 *      so it can never contradict a REMOTE header.
 */
export function deriveTransport(input: TransportInput): TransportProjection {
  const { localRuntime, remoteRuntime, signedIn } = input;

  if (signedIn === false) {
    return {
      executionPath: "none",
      headerLabel: "SIGNED OUT",
      footerLabel: "TOOLS OFF",
      remoteActive: false,
      showRemote: false,
      headerSeverity: "error",
      footerSeverity: "error",
    };
  }

  const showRemote = remoteRuntime !== "offline";
  // REMOTE is claimed ONLY on a fully established connection.
  const remoteActive = remoteRuntime === "connected";

  // ─── Footer: local TOOL availability (never an execution claim) ───
  const footerLabel = localRuntime === "ready" ? "TOOLS"
    : localRuntime === "error" ? "TOOLS ERR"
    : "TOOLS…";
  const footerSeverity: TransportProjection["footerSeverity"] =
    localRuntime === "ready" ? "ok" : localRuntime === "error" ? "error" : "pending";

  // ─── Header: the actual execution path ────────────────────────────
  if (!showRemote) {
    const headerLabel = localRuntime === "ready" ? "LOCAL"
      : localRuntime === "error" ? "LOCAL ERR"
      : "LOCAL…";
    return {
      executionPath: localRuntime === "error" ? "none" : "local",
      headerLabel,
      footerLabel,
      remoteActive: false,
      showRemote: false,
      headerSeverity: localRuntime === "ready" ? "ok" : localRuntime === "error" ? "error" : "pending",
      footerSeverity,
    };
  }

  const headerLabel = remoteRuntime === "connected" ? "REMOTE"
    : remoteRuntime === "connecting" ? "REMOTE…"
    : remoteRuntime === "reconnecting" ? "REMOTE↻"
    : "REMOTE ERR";

  const headerSeverity: TransportProjection["headerSeverity"] =
    remoteRuntime === "connected" ? "ok"
      : remoteRuntime === "error" ? "error"
      : "pending";

  return {
    // Remote was requested but is not established → NOTHING is executing.
    // Critically this is never "local": a half-open remote transport must
    // not read as a working local execution path.
    executionPath: remoteActive ? "remote" : "none",
    headerLabel,
    footerLabel,
    remoteActive,
    showRemote: true,
    headerSeverity,
    footerSeverity,
  };
}
