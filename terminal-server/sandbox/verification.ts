/**
 * Sandbox verification service — the signal half of Phase 0
 * (SANDBOX-PLAN.md §4).
 *
 * The service owns the most recent {@link CanaryReport} for one
 * provider and answers exactly one question: "is there a fresh, green
 * canary proving verified sandbox isolation *right now*?"
 *
 * Semantics, mirroring the isolation policy's rule that a
 * configuration claim is not proof:
 *
 *   - never-run: no canary has completed yet           -> not verified
 *   - failed:    the latest canary did not pass        -> not verified
 *   - stale:     the latest canary passed but is older -> not verified
 *                than the freshness window
 *   - verified:  the latest canary passed and is fresh -> verified
 *
 * `isVerified()` is the only accessor a future policy check (Phase 4,
 * seam S1) may consult, and it returns true exclusively in the
 * "verified" state. There is deliberately no environment variable,
 * flag, or setter that can mark a provider verified — the canary
 * passing is the only path, exactly as isolation-policy.ts prescribes.
 *
 * Phase 0 shipping state: the terminal constructs this service over
 * {@link DisabledSandboxProvider} (see
 * {@link createDefaultSandboxVerificationService}), whose canary can
 * never pass, so the signal is never "verified" and no behavior
 * changes. Phase 1 update: server.ts now builds the stack via
 * createSandboxExecStack (exec-router.ts) and calls `start()` at
 * boot when a real provider is configured; with the default disabled
 * provider nothing is wired and behavior is still unchanged.
 */

import { runSandboxCanary, type CanaryOptions, type CanaryReport } from "./canary";
import { DisabledSandboxProvider } from "./disabled-provider";
import type { CanaryProvider } from "./provider";

/** Default freshness window for a green canary: five minutes. */
export const DEFAULT_VERIFICATION_MAX_AGE_MS = 5 * 60_000;

export type SandboxVerificationState = "verified" | "failed" | "stale" | "never-run";

export interface VerifiedSandboxSignal {
  state: SandboxVerificationState;
  /** True only in the "verified" state. */
  verified: boolean;
  provider: string;
  /** The most recent canary report, or null if none has completed. */
  report: CanaryReport | null;
  /** ISO timestamp the latest report finished at, or null. */
  checkedAt: string | null;
  /** ISO timestamp after which a green report stops counting, or null. */
  freshUntil: string | null;
}

export interface SandboxVerificationServiceOptions {
  /** How long a passing canary stays fresh. Default 5 minutes. */
  maxAgeMs?: number;
  /** Options forwarded to every canary run. */
  canary?: CanaryOptions;
  /** Clock injection (tests). */
  now?: () => number;
  /** Called with each completed report (the server's logging hook). */
  onReport?: (report: CanaryReport) => void;
}

export class SandboxVerificationService {
  private readonly provider: CanaryProvider;
  private readonly maxAgeMs: number;
  private readonly canaryOptions: CanaryOptions;
  private readonly now: () => number;
  private readonly onReport?: (report: CanaryReport) => void;

  private lastReport: CanaryReport | null = null;
  private lastFinishedMs = 0;
  private inFlight: Promise<CanaryReport> | null = null;

  constructor(provider: CanaryProvider, options: SandboxVerificationServiceOptions = {}) {
    this.provider = provider;
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_VERIFICATION_MAX_AGE_MS;
    this.canaryOptions = options.canary ?? {};
    this.now = options.now ?? Date.now;
    this.onReport = options.onReport;
  }

  /** The provider this service verifies. */
  get providerName(): string {
    return this.provider.name;
  }

  /**
   * Boot hook: kick off a canary without blocking startup. Safe to
   * call once at process start; failures land in the report, never in
   * an unhandled rejection.
   */
  start(): void {
    void this.runNow().catch(() => {
      // runNow() does not reject by design; this guard exists so a
      // future regression can never crash server boot.
    });
  }

  /**
   * On-demand hook: run the canary now and cache the report.
   * Concurrent calls share a single in-flight run.
   */
  runNow(): Promise<CanaryReport> {
    if (this.inFlight) return this.inFlight;
    const run = (async () => {
      try {
        const report = await runSandboxCanary(this.provider, {
          ...this.canaryOptions,
          now: this.canaryOptions.now ?? this.now,
        });
        this.lastReport = report;
        this.lastFinishedMs = this.now();
        this.onReport?.(report);
        return report;
      } finally {
        this.inFlight = null;
      }
    })();
    this.inFlight = run;
    return run;
  }

  /** The current signal, applying the freshness window. */
  getSignal(): VerifiedSandboxSignal {
    const report = this.lastReport;
    if (!report) {
      return {
        state: "never-run",
        verified: false,
        provider: this.provider.name,
        report: null,
        checkedAt: null,
        freshUntil: null,
      };
    }
    const freshUntilMs = this.lastFinishedMs + this.maxAgeMs;
    const freshUntil = new Date(freshUntilMs).toISOString();
    if (!report.passed) {
      return {
        state: "failed",
        verified: false,
        provider: this.provider.name,
        report,
        checkedAt: report.finishedAt,
        freshUntil,
      };
    }
    if (this.now() > freshUntilMs) {
      return {
        state: "stale",
        verified: false,
        provider: this.provider.name,
        report,
        checkedAt: report.finishedAt,
        freshUntil,
      };
    }
    return {
      state: "verified",
      verified: true,
      provider: this.provider.name,
      report,
      checkedAt: report.finishedAt,
      freshUntil,
    };
  }

  /** True only when a fresh, green canary exists right now. */
  isVerified(): boolean {
    return this.getSignal().verified;
  }
}

/**
 * The Phase 0 default: a verification service over the disabled
 * provider. Its canary always fails at the health probe, so the
 * signal can never read "verified" — production behavior is unchanged.
 */
export function createDefaultSandboxVerificationService(
  options: SandboxVerificationServiceOptions = {},
): SandboxVerificationService {
  return new SandboxVerificationService(new DisabledSandboxProvider(), options);
}
