export type TransportProjection = "REMOTE" | "TOOLS" | "CONNECTING" | "REMOTE ERR";

/** One truth source for header/footer transport labels. */
export function projectTransport(remoteRuntime: string): TransportProjection {
  if (remoteRuntime === "connected") return "REMOTE";
  if (remoteRuntime === "connecting" || remoteRuntime === "reconnecting") return "CONNECTING";
  if (remoteRuntime === "error") return "REMOTE ERR";
  return "TOOLS";
}
