"use client";

/**
 * Business Profile — client-side accessors.
 *
 * `getBusinessProfile()` / `saveBusinessProfile()` talk to the API routes.
 * The pending-intake helpers carry a confirmed description from a
 * project-less surface (the dashboard composer) into Studio, where the
 * greeter adopts it into the active project on first render.
 */

import type { BusinessProfile, BusinessTypeInference } from "./business-profile";

const PENDING_INTAKE_KEY = "litt.guidedStart.pendingIntake.v1";

export interface PendingIntake {
  description: string;
  inference: BusinessTypeInference;
  profile: BusinessProfile;
  /** Where the intake was captured ("dashboard" | "greeter"). */
  source: string;
  capturedAt: string;
}

/**
 * Client-side `getBusinessProfile()`.
 * - With projectId: GET /api/studio-projects/[projectId]/business-profile
 * - Without: GET /api/business-profile (the user's default profile)
 * Returns null when unauthenticated or when no profile exists.
 */
export async function getBusinessProfile(
  projectId?: string,
): Promise<BusinessProfile | null> {
  const url = projectId
    ? `/api/studio-projects/${encodeURIComponent(projectId)}/business-profile`
    : "/api/business-profile";
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as {
    profile?: BusinessProfile | null;
  } | null;
  return body?.profile ?? null;
}

/**
 * Persist a profile to a project. Returns the stored profile plus any
 * validation notes, or null when the save failed.
 */
export async function saveBusinessProfile(
  projectId: string,
  profile: BusinessProfile,
): Promise<{ profile: BusinessProfile; errors: string[] } | null> {
  const res = await fetch(
    `/api/studio-projects/${encodeURIComponent(projectId)}/business-profile`,
    {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    },
  );
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as {
    profile?: BusinessProfile;
    errors?: string[];
  } | null;
  if (!body?.profile) return null;
  return { profile: body.profile, errors: body.errors ?? [] };
}

/** Stash a confirmed intake for later adoption in Studio. */
export function savePendingIntake(intake: Omit<PendingIntake, "capturedAt">): void {
  try {
    const full: PendingIntake = { ...intake, capturedAt: new Date().toISOString() };
    window.localStorage.setItem(PENDING_INTAKE_KEY, JSON.stringify(full));
  } catch {
    // Storage full/blocked — the intake is simply not carried over.
  }
}

/** Read (without clearing) the pending intake, if any. */
export function readPendingIntake(): PendingIntake | null {
  try {
    const raw = window.localStorage.getItem(PENDING_INTAKE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingIntake>;
    if (typeof parsed.description !== "string" || !parsed.description.trim()) return null;
    return parsed as PendingIntake;
  } catch {
    return null;
  }
}

/** Clear the pending intake after it has been adopted. */
export function clearPendingIntake(): void {
  try {
    window.localStorage.removeItem(PENDING_INTAKE_KEY);
  } catch {
    // noop
  }
}

export { PENDING_INTAKE_KEY };
