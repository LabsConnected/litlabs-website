const PROMPT_KEY = "litt:first-run-prompt";
const PROJECT_KEY = "litt:first-run-project";
const CONSUMED_KEY = "litt:first-run-prompt-consumed";

export type FirstRunHandoff = {
  prompt: string;
  projectId: string;
  userId?: string | null;
};

export function onboardingStorageKey(userId: string, projectId: string): string {
  return `litt:onboarding-complete:${userId}:${projectId}`;
}

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // private mode / disabled storage
  }
}

function remove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function writeFirstRunHandoff(handoff: FirstRunHandoff): void {
  const prompt = handoff.prompt.trim();
  const projectId = handoff.projectId.trim();
  if (!prompt || !projectId) return;
  write(PROMPT_KEY, prompt);
  write(PROJECT_KEY, projectId);
  remove(CONSUMED_KEY);
  if (handoff.userId) {
    markOnboardingComplete(handoff.userId, projectId);
  }
}

export function peekFirstRunProjectId(): string | null {
  const value = read(PROJECT_KEY)?.trim();
  return value || null;
}

export function peekFirstRunPrompt(): string | null {
  const value = read(PROMPT_KEY)?.trim();
  return value || null;
}

export function resolveStudioProjectId(urlProjectId: string | null | undefined): string | null {
  const fromUrl = urlProjectId?.trim();
  if (fromUrl) return fromUrl;
  return peekFirstRunProjectId();
}

/**
 * The project id the Studio URL should carry: the explicit selection
 * first (URL param, then the first-run handoff — resolveStudioProjectId),
 * then the server-resolved active project (capabilities). CommandStudio's
 * state→URL effect writes this back as ?project= so the active project
 * is DURABLE: it survives refresh, and surface navigation that rebuilds
 * or follows URLs (the AppShell top bar) has a param to carry. Without
 * the resolved-project fallback, a bare /studio landing resolved a
 * project server-side but never pinned it, and the next param-less
 * navigation silently re-resolved to a different project (production
 * audit ART-20261111-082). An explicit param is never overridden, and
 * no id is invented when no source knows one.
 */
export function resolveActiveProjectIdForUrl(
  urlProjectId: string | null | undefined,
  resolvedProjectId: string | null | undefined,
): string | null {
  const explicit = resolveStudioProjectId(urlProjectId);
  if (explicit) return explicit;
  const resolved = resolvedProjectId?.trim();
  return resolved || null;
}

/** Prompt still pending apply. Does not consume. Survives URL clobber / remount. */
export function takeFirstRunPrompt(urlPrompt?: string | null): string | null {
  if (read(CONSUMED_KEY) === "1") return null;
  const prompt = (urlPrompt?.trim() || peekFirstRunPrompt() || "").trim();
  return prompt || null;
}

export function markFirstRunPromptConsumed(): void {
  write(CONSUMED_KEY, "1");
  remove(PROMPT_KEY);
}

export function markOnboardingComplete(userId: string | null | undefined, projectId: string): void {
  if (!userId || !projectId) return;
  try {
    localStorage.setItem(onboardingStorageKey(userId, projectId), "true");
  } catch {
    // ignore
  }
}

export function isOnboardingComplete(
  userId: string | null | undefined,
  projectId: string | null | undefined,
): boolean {
  if (!userId || !projectId) return false;
  try {
    return localStorage.getItem(onboardingStorageKey(userId, projectId)) === "true";
  } catch {
    return false;
  }
}
