/**
 * Per-file, per-test opt-in for tests that exercise the PERMITTED local path.
 * Deliberately NOT a global vitest setup file: real execution must never be
 * enabled implicitly for a whole test run. Call useTrustedLocalEnv() at the
 * top of a test file (or trustedLocalStubs() inside a custom environment
 * builder) so the opt-in is visible where the permitted path is relied on.
 * All child processes in these tests are mocked or injected.
 */
import { afterEach, beforeEach, vi } from "vitest";

export function trustedLocalStubs(): void {
  vi.stubEnv("LITT_LOCAL_EXECUTION_OPT_IN", "true");
  vi.stubEnv("LITT_ISOLATION_VERIFIED", "true");
  vi.stubEnv("LITT_RESOLVED_BIND_HOST", "127.0.0.1");
}

export function useTrustedLocalEnv(): void {
  beforeEach(() => trustedLocalStubs());
  afterEach(() => vi.unstubAllEnvs());
}
