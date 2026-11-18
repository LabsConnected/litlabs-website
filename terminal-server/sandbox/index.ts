/**
 * Sandbox verification + provider (Phase 0 contract, Phase 1 E2B) —
 * public surface.
 *
 * Exports the terminal-side provider contract, the disabled provider
 * that ships as the default, the verification canary, the
 * verification-signal service, and (Phase 1) the env allowlist, the
 * E2B provider, the config factory, and the exec gate/router. See
 * README.md in this directory for the contract, the check list, and
 * how a real provider is verified.
 */

export * from "./provider";
export * from "./disabled-provider";
export * from "./canary";
export * from "./verification";
export * from "./env";
export * from "./e2b-provider";
export * from "./config";
export * from "./exec-router";
export * from "./sync";
export * from "./git-clone";
export * from "./workspace-executor";
