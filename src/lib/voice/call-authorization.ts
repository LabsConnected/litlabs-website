export interface CallAuthorizationRepo {
  isKillSwitchEngaged(): Promise<boolean>;
  hasConsent(phone: string): Promise<boolean>;
  getSpendCapCents(phone: string): Promise<number>;
  getAttemptsToday(phone: string): Promise<number>;
  recordAttempt(phone: string): Promise<void>;
}

export type AuthorizationResult =
  | { allowed: true }
  | { allowed: false; reason: string };

const DAILY_RETRY_LIMIT = 1;

/**
 * Default-deny outbound call authorization. Every check fails closed:
 * missing or unreadable data denies the call rather than allowing it.
 * Order matters — kill switch is checked first so no other repo method
 * is ever called while calling is globally disabled.
 */
export async function authorizeOutboundCall(
  params: { phone: string; requestedBy: string; estimatedCostCents: number },
  repo: CallAuthorizationRepo,
): Promise<AuthorizationResult> {
  if (await repo.isKillSwitchEngaged()) {
    return { allowed: false, reason: "kill_switch_engaged" };
  }

  if (!(await repo.hasConsent(params.phone))) {
    return { allowed: false, reason: "no_consent" };
  }

  const cap = await repo.getSpendCapCents(params.phone);
  if (params.estimatedCostCents > cap) {
    return { allowed: false, reason: "spend_cap_exceeded" };
  }

  const attemptsToday = await repo.getAttemptsToday(params.phone);
  if (attemptsToday >= DAILY_RETRY_LIMIT) {
    return { allowed: false, reason: "retry_limit_exceeded" };
  }

  await repo.recordAttempt(params.phone);
  return { allowed: true };
}
