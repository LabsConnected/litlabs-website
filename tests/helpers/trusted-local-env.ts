/**
 * Per-file, per-test opt-in for tests that exercise the PERMITTED local
 * execution path. Deliberately not a global vitest setup file: real execution
 * must never be enabled implicitly for a whole run. Child processes in these
 * tests are mocked.
 */
import { vi } from "vitest";

export function trustedLocalStubs(): void {
  vi.stubEnv("LITT_LOCAL_EXECUTION_OPT_IN", "true");
  vi.stubEnv("LITT_ISOLATION_VERIFIED", "true");
  vi.stubEnv("LITT_RESOLVED_BIND_HOST", "127.0.0.1");
}
